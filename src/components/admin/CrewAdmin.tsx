'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { admin } from '@/lib/admin-client';
import { listCrewMembers, type CrewMemberDoc } from '@/lib/admin-firestore';
import { FunctionError } from '@/lib/functions-client';
import { clsx } from '@/lib/clsx';

type CrewRow = CrewMemberDoc & { pushDevices: number };
type Role = 'captain' | 'mate';

const inputClass =
  'w-full rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2 text-base focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

const primaryButton =
  'px-5 py-2.5 rounded-[10px] bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium disabled:opacity-60';

const quietButton =
  'px-3 py-1.5 rounded-lg border border-[var(--color-ink)]/15 text-sm font-medium hover:border-[var(--color-ink)] disabled:opacity-60';

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
      <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 p-6 text-center text-sm text-[var(--color-ink-soft)] animate-pulse">
        Loading crew…
      </div>
    );
  }

  const missingEmail = rows?.filter((r) => !r.email) ?? [];

  return (
    <div className="space-y-6">
      {shared ? (
        <SharePanel credentials={shared} onDone={() => setShared(null)} />
      ) : adding ? (
        <AddCrewForm
          onCancel={() => setAdding(false)}
          onAdded={(creds, name) => {
            setAdding(false);
            if (creds) setShared(creds);
            else setNotice(`${name} is on the crew.`);
            refresh();
          }}
        />
      ) : null}

      {notice && (
        <p role="status" className="rounded-2xl bg-[var(--color-brand-blue)]/10 border border-[var(--color-brand-blue)]/20 p-3 text-sm">
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

      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <h2 className="font-display text-lg">On the crew</h2>
          {!adding && !shared && (
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                setAdding(true);
              }}
              className={quietButton}
            >
              Add someone
            </button>
          )}
        </div>
        {loadError && (
          <p role="alert" className="px-5 pb-5 text-sm text-[var(--color-coral-dark)]">
            {loadError}
          </p>
        )}
        {rows?.length === 0 && (
          <p className="px-5 pb-5 text-sm text-[var(--color-ink-soft)]">Nobody yet.</p>
        )}
        {rows && rows.length > 0 && (
          <ul className="divide-y divide-[var(--color-ink)]/8 border-t border-[var(--color-ink)]/8">
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
    <section className="rounded-2xl border border-[var(--color-brand-blue)]/25 bg-[var(--color-brand-blue)]/8 p-5 space-y-3">
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
        className={`${quietButton} shrink-0`}
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
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={values.alertsOn}
          onChange={(e) => set({ alertsOn: e.target.checked })}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-brand-blue)]"
        />
        <span className="text-sm">
          <span className="font-medium">Crew emails</span>
          <span className="block text-[var(--color-ink-soft)]">
            New bookings, cancellations, reschedule requests, and tomorrow’s
            trips every evening at 8.
          </span>
        </span>
      </label>
    </div>
  );
}

function Labelled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[var(--color-ink-soft)] mt-1">{hint}</span>}
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
  const email = values.email.trim().toLowerCase();
  const givesPassword = !!email && appSignIn;

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
    <form
      onSubmit={submit}
      className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5 space-y-4"
    >
      <h2 className="font-display text-lg">Add a crew member</h2>
      <CrewFields values={values} onChange={setValues} />
      {email && (
        <div className="space-y-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={appSignIn}
              onChange={(e) => setAppSignIn(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-brand-blue)]"
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
              <span className="block text-xs text-[var(--color-ink-soft)] mt-1">
                Made up for you. You’ll get it in a message to send them after
                you add them. It’s stored scrambled, so you won’t see it again,
                but you can always reset it.
              </span>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-[var(--color-coral-dark)]">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className={quietButton}>
          Cancel
        </button>
        <button type="submit" disabled={busy || (givesPassword && !password)} className={primaryButton}>
          {busy ? 'Adding…' : 'Add to crew'}
        </button>
      </div>
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

  // A reset starts from a row further down the page.
  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      className="scroll-mt-20 rounded-2xl border border-[var(--color-brand-blue)]/25 bg-[var(--color-brand-blue)]/8 p-5 space-y-3"
    >
      <div>
        <h2 className="font-display text-lg">
          {credentials.isReset ? `New password for ${firstName}` : `${firstName} is on the crew`}
        </h2>
        <p className="text-sm text-[var(--color-ink-soft)] mt-0.5">
          Send them this now. The password won’t be shown again.
        </p>
      </div>
      <pre className="whitespace-pre-wrap rounded-xl bg-white p-4 text-sm font-sans leading-relaxed border border-[var(--color-ink)]/8">
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
        <button type="button" onClick={onDone} className={`${quietButton} ml-auto`}>
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

  const firstName = row.name.split(' ')[0];
  const hasPassword = !!row.passwordSetAt;
  const lastSignIn = formatWhen(row.lastSignInAt);

  function startEdit() {
    setValues({
      name: row.name,
      role: roleOf(row),
      email: row.email ?? '',
      phone: row.phone ?? '',
      alertsOn: alertsOnFor(row),
    });
    setError(null);
    setMode('edit');
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!values) return;
    const email = values.email.trim().toLowerCase();
    if (!email && row.email && hasPassword) {
      const ok = confirm(
        `Remove ${firstName}’s email? They’ll stop getting crew emails and be signed out of the crew app.`,
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
    setMode('password');
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await admin.setCrewPassword(row.id, password.trim());
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
        `Remove ${row.name} from the crew? They’ll stop getting crew emails, be signed out, and stop getting notifications.`,
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
        <form onSubmit={saveEdit} className="space-y-4">
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
          <div className="min-w-0">
            <p className="font-semibold">
              {row.name}{' '}
              <span className="ml-1 inline-flex items-center rounded-full bg-[var(--color-ink)]/8 px-2 py-0.5 text-xs font-medium align-middle">
                {roleOf(row) === 'captain' ? 'Captain' : 'Mate'}
              </span>
            </p>
            <p className={clsx('text-sm break-all', row.email ? 'text-[var(--color-ink-soft)]' : 'text-[var(--color-coral-dark)]')}>
              {row.email ?? 'No email yet'}
            </p>
            {row.phone && <p className="text-sm text-[var(--color-ink-soft)]">{row.phone}</p>}
            <p className="text-xs text-[var(--color-ink-soft)] mt-1">
              {!row.email ? 'No crew emails until there’s an address' : alerts ? 'Crew emails on' : 'Crew emails off'}
              {' · '}
              {!hasPassword
                ? 'No app sign-in'
                : lastSignIn
                  ? `App: last signed in ${lastSignIn}`
                  : 'App: hasn’t signed in yet'}
              {row.pushDevices > 0 &&
                ` · Notifications on (${row.pushDevices} ${row.pushDevices === 1 ? 'phone' : 'phones'})`}
            </p>
          </div>
          {mode === 'view' && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={startEdit} disabled={busy} className={quietButton}>
                Edit
              </button>
              {row.email && (
                <button type="button" onClick={startPassword} disabled={busy} className={quietButton}>
                  {hasPassword ? 'Reset password' : 'App password'}
                </button>
              )}
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className={`${quietButton} text-[var(--color-coral-dark)]`}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      )}

      {mode === 'password' && (
        <form onSubmit={savePassword} className="mt-3 space-y-2">
          <PasswordField value={password} onChange={setPassword} />
          <p className="text-xs text-[var(--color-ink-soft)]">
            {hasPassword
              ? `Saving signs ${firstName} out on every phone until they sign in with the new password.`
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

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--color-coral-dark)]">
          {error}
        </p>
      )}
    </li>
  );
}
