'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { admin } from '@/lib/admin-client';
import { listCrewMembers, type CrewMemberDoc } from '@/lib/admin-firestore';
import { FunctionError } from '@/lib/functions-client';
import { clsx } from '@/lib/clsx';
import {
  Avatar,
  Badge,
  PanelBody,
  PanelFooter,
  PanelHeader,
  Switch,
  buttonClass,
  hintClass,
  inputClass,
  labelClass,
  panelClass,
} from './ui';

type CrewRow = CrewMemberDoc & { pushDevices: number };
type Role = 'captain' | 'mate';

const primaryButton = buttonClass('primary');

const quietButton = buttonClass('secondary');

// No i/l/1 or o/0, so it can be read out or typed off a text message.
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Random 12-character password in groups of four, e.g. `k7m4-xq9p-2wht`. */
function randomPassword(): string {
  const chars: string[] = [];
  const limit = 256 - (256 % PASSWORD_ALPHABET.length); // avoid modulo bias
  while (chars.length < 12) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && chars.length < 12) {
        chars.push(PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]!);
      }
    }
  }
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)]
    .map((g) => g.join(''))
    .join('-');
}

function formatWhen(ts: CrewMemberDoc['createdAt']): string | null {
  if (!ts) return null;
  return new Date(ts.seconds * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof FunctionError ? err.message : fallback;
}

/** Crew docs from before roles existed are mates with alerts on. */
const roleOf = (row: CrewMemberDoc): Role => row.role ?? 'mate';
const alertsOnFor = (row: CrewMemberDoc): boolean => row.alertsOn !== false;

interface Credentials {
  name: string;
  email: string;
  password: string;
  isReset: boolean;
}

export function CrewAdmin() {
  const [rows, setRows] = useState<CrewRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shared, setShared] = useState<Credentials | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  /** Set when the add form or share panel is closed, so focus can go back to "Add someone". */
  const backToAdd = useRef(false);

  // The add form and the share panel stand in for the buttons that opened
  // them. Closing one brings "Add someone" back: focus goes there, and to the
  // notice when adding left one, rather than to the page.
  useEffect(() => {
    if (!backToAdd.current || adding || shared) return;
    backToAdd.current = false;
    addRef.current?.focus();
  }, [adding, shared]);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  function refresh() {
    return listCrewMembers().then(
      (crew) => {
        setRows(crew);
        setLoadError(null);
      },
      (err: unknown) =>
        setLoadError(err instanceof Error ? err.message : 'Failed to load.'),
    );
  }

  useEffect(() => {
    listCrewMembers().then(setRows, (err: unknown) =>
      setLoadError(err instanceof Error ? err.message : 'Failed to load.'),
    );
  }, []);

  // Wait for the first load so the add form (and its random password) only
  // ever renders in the browser.
  if (rows === null && !loadError) {
    return (
      <div className={clsx(panelClass, 'p-6 text-center text-sm text-[var(--color-ink-soft)] animate-pulse')}>
        Loading crew…
      </div>
    );
  }

  const missingEmail = rows?.filter((r) => !r.email) ?? [];

  return (
    <div className="space-y-6">
      {shared ? (
        <SharePanel
          credentials={shared}
          onDone={() => {
            backToAdd.current = true;
            setShared(null);
          }}
        />
      ) : adding ? (
        <AddCrewForm
          onCancel={() => {
            backToAdd.current = true;
            setAdding(false);
          }}
          onAdded={(creds, name) => {
            setAdding(false);
            if (creds) setShared(creds);
            else setNotice(`${name} is on the crew.`);
            refresh();
          }}
        />
      ) : null}

      {notice && (
        <p
          ref={noticeRef}
          role="status"
          tabIndex={-1}
          className="rounded-2xl bg-[var(--color-mist)] border border-[var(--color-spring)]/30 p-3 text-sm outline-none"
        >
          {notice}
        </p>
      )}

      {rows?.length === 0 && <SeedCrew onSeeded={refresh} />}

      {missingEmail.length > 0 && (
        <p className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          No email yet for {missingEmail.map((r) => r.name.split(' ')[0]).join(', ')}, so
          they don’t get crew emails. Tap Edit to add one.
        </p>
      )}

      <section className={clsx(panelClass, 'overflow-hidden')}>
        <PanelHeader
          title="On the crew"
          aside={
            <span className="flex items-center gap-2">
              {rows && rows.length > 0 && <Badge>{rows.length}</Badge>}
              {!adding && !shared && (
                <button
                  ref={addRef}
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setAdding(true);
                  }}
                  className={buttonClass('secondary', 'sm')}
                >
                  Add someone
                </button>
              )}
            </span>
          }
        />
        {loadError && (
          <p role="alert" className="p-5 text-sm text-[var(--color-coral-dark)]">
            {loadError}
          </p>
        )}
        {rows?.length === 0 && (
          <p className="p-5 text-sm text-[var(--color-ink-soft)]">Nobody yet.</p>
        )}
        {rows && rows.length > 0 && (
          <ul className="divide-y divide-[var(--color-line)]">
            {rows.map((row) => (
              <CrewRowItem
                key={row.id}
                row={row}
                onPasswordSet={(password, isReset) =>
                  setShared({ name: row.name, email: row.email ?? '', password, isReset })
                }
                onChanged={refresh}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** First visit: one tap adds the crew Travis named (him, Lacy, Faith, Megan). */
function SeedCrew({ onSeeded }: { onSeeded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function seed() {
    setBusy(true);
    setError(null);
    try {
      await admin.seedCrew();
      onSeeded();
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t add them. Try again.'));
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--color-spring)]/30 bg-[var(--color-mist)] shadow-[var(--shadow-panel)] p-5 space-y-3">
      <h2 className="font-display text-lg">Start with your usual crew</h2>
      <p className="text-sm">
        Adds you as captain, and Lacy, Faith and Megan as mates, all with crew
        emails on. Add the mates’ email addresses afterwards so the emails
        reach them.
      </p>
      {error && (
        <p role="alert" className="text-sm text-[var(--color-coral-dark)]">
          {error}
        </p>
      )}
      <button type="button" onClick={seed} disabled={busy} className={primaryButton}>
        {busy ? 'Adding…' : 'Add Travis, Lacy, Faith and Megan'}
      </button>
    </section>
  );
}

function PasswordField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        minLength={8}
        maxLength={128}
        required
        autoComplete="off"
        spellCheck={false}
        aria-label="Password"
        className={`${inputClass} font-mono`}
      />
      <button
        type="button"
        onClick={() => onChange(randomPassword())}
        className={clsx(quietButton, 'shrink-0')}
      >
        New password
      </button>
    </div>
  );
}

interface CrewFieldValues {
  name: string;
  role: Role;
  email: string;
  phone: string;
  alertsOn: boolean;
}

/** Name, role, email, phone and the alerts switch: shared by add and edit. */
function CrewFields({
  values,
  onChange,
}: {
  values: CrewFieldValues;
  onChange: (v: CrewFieldValues) => void;
}) {
  const set = (patch: Partial<CrewFieldValues>) => onChange({ ...values, ...patch });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Labelled label="Name">
          <input
            type="text"
            value={values.name}
            onChange={(e) => set({ name: e.target.value })}
            maxLength={80}
            required
            autoComplete="off"
            className={inputClass}
          />
        </Labelled>
        <Labelled label="Role">
          <select
            value={values.role}
            onChange={(e) => set({ role: e.target.value as Role })}
            className={inputClass}
          >
            <option value="mate">Mate</option>
            <option value="captain">Captain</option>
          </select>
        </Labelled>
        <Labelled label="Email" hint="Crew emails go here.">
          <input
            type="email"
            inputMode="email"
            value={values.email}
            onChange={(e) => set({ email: e.target.value })}
            maxLength={160}
            autoComplete="off"
            className={inputClass}
          />
        </Labelled>
        <Labelled label="Mobile phone" hint="Saved for later. Nothing is texted yet.">
          <input
            type="tel"
            inputMode="tel"
            value={values.phone}
            onChange={(e) => set({ phone: e.target.value })}
            maxLength={40}
            autoComplete="off"
            className={inputClass}
          />
        </Labelled>
      </div>
      <div>
        <Switch checked={values.alertsOn} onChange={(alertsOn) => set({ alertsOn })}>
          Crew emails
        </Switch>
        <span className={clsx(hintClass, 'mt-0')}>
          New bookings, cancellations, reschedule requests, and tomorrow’s
          trips every evening at 8.
        </span>
      </div>
    </div>
  );
}

function Labelled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
      {hint && <span className={hintClass}>{hint}</span>}
    </label>
  );
}

function AddCrewForm({
  onAdded,
  onCancel,
}: {
  /** `creds` when they were given an app password to send them. */
  onAdded: (creds: Credentials | null, name: string) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<CrewFieldValues>({
    name: '',
    role: 'mate',
    email: '',
    phone: '',
    alertsOn: true,
  });
  const [appSignIn, setAppSignIn] = useState(true);
  const [password, setPassword] = useState(randomPassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const email = values.email.trim().toLowerCase();
  const givesPassword = !!email && appSignIn;

  // It opens in place of the "Add someone" button: start in its first field.
  useEffect(() => {
    formRef.current?.querySelector('input')?.focus();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const name = values.name.trim();
      await admin.addCrewMember({
        name,
        role: values.role,
        email: email || null,
        phone: values.phone.trim() || null,
        alertsOn: values.alertsOn,
        ...(givesPassword ? { password: password.trim() } : {}),
      });
      onAdded(givesPassword ? { name, email, password: password.trim(), isReset: false } : null, name);
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t add them. Try again.'));
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className={clsx(panelClass, 'overflow-hidden')}>
      <PanelHeader title="Add a crew member" />
      <PanelBody className="space-y-5">
      <CrewFields values={values} onChange={setValues} />
      {email && (
        <div className="space-y-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={appSignIn}
              onChange={(e) => setAppSignIn(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-spring)]"
            />
            <span className="text-sm">
              <span className="font-medium">Crew app sign-in</span>
              <span className="block text-[var(--color-ink-soft)]">
                Lets them see upcoming tours at /crew and get phone
                notifications.
              </span>
            </span>
          </label>
          {appSignIn && (
            <div>
              <PasswordField value={password} onChange={setPassword} />
              <span className={hintClass}>
                Made up for you. You’ll get it in a message to send them after
                you add them. It’s stored scrambled, so you won’t see it again,
                but you can always reset it.
              </span>
            </div>
          )}
        </div>
      )}
      </PanelBody>
      <PanelFooter>
        {error && (
          <p role="alert" className="mr-auto text-sm font-medium text-[var(--color-coral-dark)]">
            {error}
          </p>
        )}
        <button type="button" onClick={onCancel} disabled={busy} className={quietButton}>
          Cancel
        </button>
        <button type="submit" disabled={busy || (givesPassword && !password)} className={primaryButton}>
          {busy ? 'Adding…' : 'Add to crew'}
        </button>
      </PanelFooter>
    </form>
  );
}

/** The message Travis texts a crew member after giving them a password. */
function SharePanel({
  credentials,
  onDone,
}: {
  credentials: Credentials;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const firstName = credentials.name.split(' ')[0];

  // A reset starts from a row further down the page. Focus comes here too,
  // as the form that was used is gone. The scroll is smooth by html's
  // scroll-behavior, which reduced motion turns off (an explicit behavior
  // here would override that).
  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: 'start' });
    panelRef.current?.focus({ preventScroll: true });
  }, [credentials]);
  const link = `${window.location.origin}/crew`;

  const message = credentials.isReset
    ? [
        `Hi ${firstName}, here's your password for the Manatee Crew app.`,
        '',
        link,
        `Email: ${credentials.email}`,
        `Password: ${credentials.password}`,
      ].join('\n')
    : [
        `Hi ${firstName}! You're on the Crystal River Manatee Fun crew. This app shows our booked tours and pings your phone when a new one comes in.`,
        '',
        link,
        `Email: ${credentials.email}`,
        `Password: ${credentials.password}`,
        '',
        'iPhone: open the link in Safari, tap Share, then "Add to Home Screen". Open Manatee Crew from your home screen, sign in, and tap "Turn on notifications".',
        'Android: open the link in Chrome, sign in, and tap "Turn on notifications". Add it to your home screen from the ⋮ menu.',
      ].join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      className="rounded-2xl border border-[var(--color-spring)]/30 bg-[var(--color-mist)] shadow-[var(--shadow-panel)] p-5 space-y-3 outline-none"
    >
      <div>
        <h2 className="font-display text-lg">
          {credentials.isReset ? `New password for ${firstName}` : `${firstName} is on the crew`}
        </h2>
        <p className="text-sm text-[var(--color-ink-soft)] mt-0.5">
          Send them this now. The password won’t be shown again.
        </p>
      </div>
      <pre className="whitespace-pre-wrap rounded-xl bg-white p-4 text-sm font-sans leading-relaxed border border-[var(--color-line)]">
        {message}
      </pre>
      <div className="flex flex-wrap gap-2">
        <a
          href={`sms:?&body=${encodeURIComponent(message)}`}
          className={primaryButton}
        >
          Text it
        </a>
        <button type="button" onClick={copy} className={quietButton}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" onClick={onDone} className={clsx(quietButton, 'ml-auto')}>
          Done
        </button>
      </div>
    </section>
  );
}

function CrewRowItem({
  row,
  onPasswordSet,
  onChanged,
}: {
  row: CrewRow;
  onPasswordSet: (password: string, isReset: boolean) => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'password'>('view');
  const [values, setValues] = useState<CrewFieldValues | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [calendarSent, setCalendarSent] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const passwordRef = useRef<HTMLButtonElement>(null);
  /** The button that opened the form, to hand focus back to when it closes. */
  const opener = useRef<RefObject<HTMLButtonElement | null> | null>(null);

  // Edit and Reset password swap the row's buttons for a form: focus goes to
  // its first field, and back to the button when it closes, rather than to
  // the page. A saved password hands it to the share panel instead.
  useEffect(() => {
    if (mode !== 'view') {
      formRef.current?.querySelector('input')?.focus();
    } else {
      opener.current?.current?.focus();
      opener.current = null;
    }
  }, [mode]);

  const firstName = row.name.split(' ')[0];
  const hasPassword = !!row.passwordSetAt;
  const lastSignIn = formatWhen(row.lastSignInAt);
  const calendarSince = formatWhen(row.calendarLinkIssuedAt);

  async function sendCalendarLink() {
    if (
      calendarSince &&
      !confirm(
        `Send ${firstName} a new calendar link? The one they have now stops working, so they’ll need to add the new one.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setSending(true);
    setError(null);
    setCalendarSent(null);
    try {
      const r = await admin.sendCrewCalendarLink(row.id);
      setCalendarSent(`Calendar link emailed to ${r.email}.${r.replacedLinks > 0 ? ' Their old link no longer works.' : ''}`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t send the calendar link. Try again in a minute.'));
    } finally {
      setBusy(false);
      setSending(false);
    }
  }

  function startEdit() {
    setValues({
      name: row.name,
      role: roleOf(row),
      email: row.email ?? '',
      phone: row.phone ?? '',
      alertsOn: alertsOnFor(row),
    });
    setError(null);
    opener.current = editRef;
    setMode('edit');
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!values) return;
    const email = values.email.trim().toLowerCase();
    // Their sign-in and calendar link go with the email (adminUpdateCrewMember).
    if (!email && row.email && (hasPassword || calendarSince)) {
      const ok = confirm(
        `Remove ${firstName}’s email? They’ll stop getting crew emails${hasPassword ? ' and be signed out of the crew app' : ''}.${calendarSince ? ' Their calendar link stops working too.' : ''}`,
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      await admin.updateCrewMember(row.id, {
        name: values.name.trim(),
        role: values.role,
        email: email || null,
        phone: values.phone.trim() || null,
        alertsOn: values.alertsOn,
      });
      setMode('view');
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t save that. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  function startPassword() {
    setPassword(randomPassword());
    setError(null);
    opener.current = passwordRef;
    setMode('password');
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await admin.setCrewPassword(row.id, password.trim());
      opener.current = null;
      setMode('view');
      onPasswordSet(password.trim(), hasPassword);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t save the password.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Remove ${row.name} from the crew? They’ll stop getting crew emails, be signed out, stop getting notifications, and their calendar link stops working.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await admin.removeCrewMember(row.id);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t remove them.'));
      setBusy(false);
    }
  }

  const alerts = alertsOnFor(row);

  return (
    <li className="px-5 py-4">
      {mode === 'edit' && values ? (
        <form ref={formRef} onSubmit={saveEdit} className="space-y-4">
          <CrewFields values={values} onChange={setValues} />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setMode('view')} disabled={busy} className={quietButton}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar name={row.name} />
            <div className="min-w-0">
              <p className="font-semibold">
                {row.name}{' '}
                <Badge tone={roleOf(row) === 'captain' ? 'sand' : 'muted'} className="ml-1 align-middle">
                  {roleOf(row) === 'captain' ? 'Captain' : 'Mate'}
                </Badge>
              </p>
              <p className={clsx('text-sm break-all', row.email ? 'text-[var(--color-ink-soft)]' : 'text-[var(--color-coral-dark)]')}>
                {row.email ?? 'No email yet'}
              </p>
              {row.phone && <p className="text-sm text-[var(--color-ink-soft)]">{row.phone}</p>}
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-ink-soft)]">
                <Badge tone={row.email && alerts ? 'spring' : 'muted'}>
                  {!row.email ? 'No crew emails until there’s an address' : alerts ? 'Crew emails on' : 'Crew emails off'}
                </Badge>
                {hasPassword && (
                  <Badge tone={row.pushDevices > 0 ? 'spring' : 'muted'}>
                    {row.pushDevices > 0
                      ? `Notifications on (${row.pushDevices} ${row.pushDevices === 1 ? 'phone' : 'phones'})`
                      : 'Notifications off'}
                  </Badge>
                )}
                {!hasPassword
                  ? 'No app sign-in'
                  : lastSignIn
                    ? `App: last signed in ${lastSignIn}`
                    : 'App: hasn’t signed in yet'}
              </p>
              {row.email && (
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-ink-soft)]">
                  <Badge tone={calendarSince ? 'spring' : 'muted'}>
                    {calendarSince ? 'Calendar link sent' : 'No calendar link'}
                  </Badge>
                  {calendarSince && calendarSince}
                </p>
              )}
            </div>
          </div>
          {mode === 'view' && (
            <div className="flex flex-wrap gap-2">
              <button ref={editRef} type="button" onClick={startEdit} disabled={busy} className={buttonClass('secondary', 'sm')}>
                Edit
              </button>
              {row.email && (
                <button type="button" onClick={sendCalendarLink} disabled={busy} className={buttonClass('secondary', 'sm')}>
                  {sending ? 'Sending…' : 'Send calendar link'}
                </button>
              )}
              {row.email && (
                <button ref={passwordRef} type="button" onClick={startPassword} disabled={busy} className={buttonClass('secondary', 'sm')}>
                  {hasPassword ? 'Reset password' : 'App password'}
                </button>
              )}
              <button type="button" onClick={remove} disabled={busy} className={buttonClass('danger', 'sm')}>
                Remove
              </button>
            </div>
          )}
        </div>
      )}

      {mode === 'password' && (
        <form ref={formRef} onSubmit={savePassword} className="mt-3 space-y-2">
          <PasswordField value={password} onChange={setPassword} />
          <p className="text-xs text-[var(--color-ink-soft)]">
            {hasPassword
              ? `Saving signs ${firstName} out and stops notifications on every phone until they sign in with the new password. Their calendar link stops working too: send them a new one after.`
              : `Lets ${firstName} sign in to the crew app at /crew with ${row.email}.`}
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy ? 'Saving…' : 'Save password'}
            </button>
            <button
              type="button"
              onClick={() => setMode('view')}
              disabled={busy}
              className={quietButton}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {calendarSent && (
        <p role="status" className="mt-2 text-sm text-[var(--color-spring)]">
          {calendarSent}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--color-coral-dark)]">
          {error}
        </p>
      )}
    </li>
  );
}
