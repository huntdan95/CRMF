/**
 * Sending a crew member their calendar link (lib/crew-calendar.ts) and the
 * email that carries it, against an in-memory stand-in for Firestore. Run
 * with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import {
  CALENDARS,
  TOKENS,
  calendarLinkDocs,
  calendarUrls,
  sendCrewCalendarLink,
  sha256Hex,
  type CalendarLinkMessage,
} from '../src/lib/crew-calendar';
import { buildCrewCalendarEmail } from '../src/lib/crew-calendar-email';

type Data = Record<string, unknown>;

/**
 * Just enough Firestore for these docs: get/set/update/delete by path,
 * `where(field, '==', v)`, and transactions that apply their writes at the
 * end (no retries: nothing here changes the store mid-transaction).
 */
function fakeStore(initial: Record<string, Data>) {
  const store = new Map(Object.entries(initial));
  const write = (path: string, data: Data | null, merge = false) => {
    if (data === null) return void store.delete(path);
    const next: Data = merge ? { ...store.get(path) } : {};
    for (const [k, v] of Object.entries(data)) {
      if (v instanceof FieldValue && v.isEqual(FieldValue.delete())) delete next[k];
      else next[k] = v instanceof FieldValue ? 'serverTimestamp' : v;
    }
    store.set(path, next);
  };
  const snap = (path: string) => ({
    id: path.split('/').pop()!,
    exists: store.has(path),
    ref: docRef(path),
    data: () => (store.has(path) ? { ...store.get(path) } : undefined),
    get: (f: string) => store.get(path)?.[f],
  });
  function docRef(path: string) {
    return {
      path,
      id: path.split('/').pop()!,
      get: async () => snap(path),
      set: async (d: Data) => write(path, d),
      update: async (d: Data) => {
        assert.ok(store.has(path), `no doc ${path}`);
        write(path, d, true);
      },
      delete: async () => write(path, null),
    };
  }
  type Ref = ReturnType<typeof docRef>;
  const collection = (name: string) => ({
    doc: (id: string) => docRef(`${name}/${id}`),
    where: (field: string, op: string, value: unknown) => {
      assert.equal(op, '==');
      const run = () => {
        const docs = [...store.keys()]
          .filter((p) => p.startsWith(`${name}/`) && store.get(p)![field] === value)
          .map(snap);
        return { size: docs.length, empty: docs.length === 0, docs };
      };
      return { get: async () => run(), run };
    },
  });
  const db = {
    collection,
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
      const writes: Array<() => void> = [];
      const result = await fn({
        get: async (r: Ref | { run: () => unknown }) => ('run' in r ? r.run() : snap(r.path)),
        set: (r: Ref, d: Data) => writes.push(() => write(r.path, d)),
        update: (r: Ref, d: Data) => writes.push(() => write(r.path, d, true)),
        delete: (r: Ref) => writes.push(() => write(r.path, null)),
      });
      writes.forEach((w) => w());
      return result;
    },
  };
  return { db: db as unknown as Firestore, store };
}

const LACY = { 'crew/lacy': { name: 'Lacy Example', email: 'lacy@example.com' } };
const BASE = 'https://crystalrivermanateefun.com';

function tokensFor(store: Map<string, Data>, crewId: string): string[] {
  return [...store.entries()].filter(([p, d]) => p.startsWith(`${TOKENS}/`) && d.crewId === crewId).map(([p]) => p);
}

/** Like the feed route's check: the token doc exists and crewCalendars points at it. */
function works(store: Map<string, Data>, token: string): boolean {
  const hash = sha256Hex(token);
  const t = store.get(`${TOKENS}/${hash}`);
  if (!t) return false;
  const crewId = t.crewId as string;
  return store.has(`crew/${crewId}`) && store.get(`${CALENDARS}/${crewId}`)?.tokenHash === hash;
}

function tokenOf(msg: CalendarLinkMessage): string {
  return msg.httpsUrl.split('/').pop()!;
}

describe('sendCrewCalendarLink', () => {
  test('emails both links and stores only the token’s hash', async () => {
    const { db, store } = fakeStore(LACY);
    const sent: CalendarLinkMessage[] = [];
    const outcome = await sendCrewCalendarLink(
      { crewId: 'lacy', adminEmail: 'travis@example.com' },
      { db, baseUrl: BASE, send: async (m) => void sent.push(m) },
    );
    assert.deepEqual(outcome, { kind: 'sent', name: 'Lacy Example', email: 'lacy@example.com', replacedLinks: 0 });
    assert.equal(sent.length, 1);
    const token = tokenOf(sent[0]!);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/); // 32 bytes, base64url
    assert.equal(sent[0]!.to, 'lacy@example.com');
    assert.equal(sent[0]!.httpsUrl, `${BASE}/api/crew-calendar/${token}`);
    assert.equal(sent[0]!.webcalUrl, `webcal://crystalrivermanateefun.com/api/crew-calendar/${token}`);

    assert.ok(works(store, token));
    assert.deepEqual(tokensFor(store, 'lacy'), [`${TOKENS}/${sha256Hex(token)}`]);
    assert.equal(store.get(`${TOKENS}/${sha256Hex(token)}`)!.createdBy, 'travis@example.com');
    // The token itself is stored nowhere.
    assert.ok(![...store.values()].some((d) => JSON.stringify(d).includes(token)));
  });

  test('pressing it again replaces the link and kills the old one', async () => {
    const { db, store } = fakeStore(LACY);
    const sent: CalendarLinkMessage[] = [];
    const deps = { db, baseUrl: BASE, send: async (m: CalendarLinkMessage) => void sent.push(m) };
    await sendCrewCalendarLink({ crewId: 'lacy', adminEmail: 'travis@example.com' }, deps);
    const second = await sendCrewCalendarLink({ crewId: 'lacy', adminEmail: 'travis@example.com' }, deps);
    assert.equal(second.kind === 'sent' && second.replacedLinks, 1);
    const [first, now] = sent.map(tokenOf);
    assert.notEqual(first, now);
    assert.ok(!works(store, first!));
    assert.ok(works(store, now!));
    assert.equal(tokensFor(store, 'lacy').length, 1);
  });

  test('a failed email leaves the old link working and the new one never live', async () => {
    const { db, store } = fakeStore(LACY);
    const sent: CalendarLinkMessage[] = [];
    await sendCrewCalendarLink({ crewId: 'lacy', adminEmail: 'a' }, { db, baseUrl: BASE, send: async (m) => void sent.push(m) });
    let attempted: CalendarLinkMessage | null = null;
    const outcome = await sendCrewCalendarLink(
      { crewId: 'lacy', adminEmail: 'a' },
      {
        db,
        baseUrl: BASE,
        send: async (m) => {
          attempted = m;
          throw new Error('Resend failed: bad address');
        },
      },
    );
    assert.equal(outcome.kind, 'email-failed');
    assert.ok(works(store, tokenOf(sent[0]!)));
    assert.ok(!works(store, tokenOf(attempted!)));
    assert.equal(tokensFor(store, 'lacy').length, 1);
  });

  test('two sent at once: the one switched on last works, not neither', async () => {
    const { db, store } = fakeStore(LACY);
    let a: CalendarLinkMessage | null = null;
    let b: CalendarLinkMessage | null = null;
    let bothSending!: () => void;
    const both = new Promise<void>((r) => (bothSending = r));
    let firstDone!: () => void;
    const afterFirst = new Promise<void>((r) => (firstDone = r));
    // Both new token docs exist before either is switched on.
    const first = sendCrewCalendarLink(
      { crewId: 'lacy', adminEmail: 'a' },
      {
        db,
        baseUrl: BASE,
        send: async (m) => {
          a = m;
          await both;
        },
      },
    );
    const second = sendCrewCalendarLink(
      { crewId: 'lacy', adminEmail: 'a' },
      {
        db,
        baseUrl: BASE,
        send: async (m) => {
          b = m;
          bothSending();
          await afterFirst;
        },
      },
    );
    assert.equal((await first).kind, 'sent');
    firstDone();
    assert.equal((await second).kind, 'sent');
    assert.ok(!works(store, tokenOf(a!)));
    assert.ok(works(store, tokenOf(b!)));
    assert.equal(tokensFor(store, 'lacy').length, 1);
  });

  test('nobody to send to', async () => {
    const { db } = fakeStore({});
    const outcome = await sendCrewCalendarLink({ crewId: 'ghost', adminEmail: 'a' }, { db, baseUrl: BASE, send: async () => {} });
    assert.deepEqual(outcome, { kind: 'not-found' });
  });

  test('removed while the email was going out: the new link is never switched on', async () => {
    const { db, store } = fakeStore(LACY);
    let msg: CalendarLinkMessage | null = null;
    const outcome = await sendCrewCalendarLink(
      { crewId: 'lacy', adminEmail: 'a' },
      {
        db,
        baseUrl: BASE,
        send: async (m) => {
          msg = m;
          store.delete('crew/lacy'); // adminRemoveCrewMember, meanwhile
        },
      },
    );
    assert.deepEqual(outcome, { kind: 'removed-meanwhile' });
    assert.ok(!works(store, tokenOf(msg!)));
    assert.deepEqual(tokensFor(store, 'lacy'), []);
  });

  test('removing them or resetting their password deletes every doc that keeps the link alive', async () => {
    const { db, store } = fakeStore(LACY);
    let msg: CalendarLinkMessage | null = null;
    await sendCrewCalendarLink({ crewId: 'lacy', adminEmail: 'a' }, { db, baseUrl: BASE, send: async (m) => void (msg = m) });
    const refs = await calendarLinkDocs('lacy', { db });
    assert.deepEqual(refs.map((r) => r.path).sort(), [`${CALENDARS}/lacy`, `${TOKENS}/${sha256Hex(tokenOf(msg!))}`].sort());
    for (const r of refs) await r.delete();
    assert.ok(!works(store, tokenOf(msg!)));
  });

  test('links on the staging host still work as webcal', () => {
    assert.deepEqual(calendarUrls('https://crmf--crmf-99aad.us-central1.hosted.app/', 'tok'), {
      httpsUrl: 'https://crmf--crmf-99aad.us-central1.hosted.app/api/crew-calendar/tok',
      webcalUrl: 'webcal://crmf--crmf-99aad.us-central1.hosted.app/api/crew-calendar/tok',
    });
  });
});

describe('buildCrewCalendarEmail', () => {
  const email = buildCrewCalendarEmail({
    name: 'Lacy Example',
    httpsUrl: `${BASE}/api/crew-calendar/abc`,
    webcalUrl: 'webcal://crystalrivermanateefun.com/api/crew-calendar/abc',
  });

  test('both links, steps for iPhone and Google, and the lag warning', () => {
    for (const body of [email.text, email.html]) {
      assert.ok(body.includes('webcal://crystalrivermanateefun.com/api/crew-calendar/abc'));
      assert.ok(body.includes(`${BASE}/api/crew-calendar/abc`));
      assert.match(body, /Subscribe/);
      assert.match(body, /From URL/);
      assert.match(body, /Google Calendar can take hours/);
      assert.match(body, /\[CRMF\] emails/);
    }
    assert.match(email.subject, /^\[CRMF\] /);
    assert.match(email.text, /^Hi Lacy,/);
  });
});
