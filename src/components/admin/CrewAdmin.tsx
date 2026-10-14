'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { admin } from '@/lib/admin-client';
import { listCrewMembers, type CrewMemberDoc } from '@/lib/admin-firestore';
import { FunctionError } from '@/lib/functions-client';
import { clsx } from '@/lib/clsx';
import {
  Badge,
  PanelBody,
  PanelFooter,
  PanelHeader,
  buttonClass,
  hintClass,
  inputClass,
  labelClass,
  panelClass,
} from './ui';

type CrewRow = CrewMemberDoc & { pushDevices: number };

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

/** "KB" for Kyle Bennett. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase();
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof FunctionError ? err.message : fallback;
}

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

  return (
    <div className="space-y-6">
      {shared ? (
        <SharePanel credentials={shared} onDone={() => setShared(null)} />
      ) : (
        <AddCrewForm
          onAdded={(creds) => {
            setShared(creds);
            refresh();
          }}
        />
      )}

      <section className={clsx(panelClass, 'overflow-hidden')}>
        <PanelHeader title="On the crew" aside={rows && rows.length > 0 && <Badge>{rows.length}</Badge>} />
        {loadError && (
          <p role="alert" className="p-5 text-sm text-[var(--color-coral-dark)]">
            {loadError}
          </p>
        )}
        {rows?.length === 0 && (
          <p className="p-5 text-sm text-[var(--color-ink-soft)]">
            Nobody yet. Add your first crew member above.
          </p>
        )}
        {rows && rows.length > 0 && (
          <ul className="divide-y divide-[var(--color-line)]">
            {rows.map((row) => (
              <CrewRowItem
                key={row.id}
                row={row}
                onPasswordReset={(password) => {
                  setShared({ name: row.name, email: row.email, password, isReset: true });
                  // A reset turns their notifications off; update the badge.
                  refresh();
                }}
                onRemoved={refresh}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
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
        className={`${inputClass} font-mono`}
      />
      <button
        type="button"
        onClick={() => onChange(randomPassword())}
        className={clsx(buttonClass('secondary'), 'shrink-0')}
      >
        New password
      </button>
    </div>
  );
}

function AddCrewForm({ onAdded }: { onAdded: (creds: Credentials) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(randomPassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const creds = { name: name.trim(), email: email.trim().toLowerCase(), password: password.trim() };
      await admin.addCrewMember(creds);
      onAdded({ ...creds, isReset: false });
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t add them. Try again.'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={clsx(panelClass, 'overflow-hidden')}>
      <PanelHeader title="Add a crew member" />
      <PanelBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
              autoComplete="off"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={160}
              required
              autoComplete="off"
              className={inputClass}
            />
          </label>
        </div>
        <label className="block">
          <span className={labelClass}>Password</span>
          <PasswordField value={password} onChange={setPassword} />
          <span className={hintClass}>
            Made up for you. You’ll get it in a message to send them after you
            add them. It’s stored scrambled, so you won’t see it again, but you
            can always reset it.
          </span>
        </label>
      </PanelBody>
      <PanelFooter>
        {error && (
          <p role="alert" className="mr-auto text-sm font-medium text-[var(--color-coral-dark)]">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !password} className={primaryButton}>
          {busy ? 'Adding…' : 'Add to crew'}
        </button>
      </PanelFooter>
    </form>
  );
}

/** The message Travis texts a crew member after adding them or resetting their password. */
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
        `Hi ${firstName}, here's your new password for the Manatee Crew app.`,
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
      className="scroll-mt-20 rounded-2xl border border-[var(--color-spring)]/30 bg-[var(--color-mist)] shadow-[var(--shadow-panel)] p-5 space-y-3"
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
        <button type="button" onClick={onDone} className={`${quietButton} ml-auto`}>
          Done
        </button>
      </div>
    </section>
  );
}

function CrewRowItem({
  row,
  onPasswordReset,
  onRemoved,
}: {
  row: CrewRow;
  onPasswordReset: (password: string) => void;
  onRemoved: () => void;
}) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastSignIn = formatWhen(row.lastSignInAt);

  function startReset() {
    setPassword(randomPassword());
    setError(null);
    setResetting(true);
  }

  async function saveReset(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await admin.setCrewPassword(row.id, password.trim());
      setResetting(false);
      onPasswordReset(password.trim());
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t reset the password.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Remove ${row.name} from the crew? They'll be signed out and stop getting notifications.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await admin.removeCrewMember(row.id);
      onRemoved();
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t remove them.'));
      setBusy(false);
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-spring-deep)] text-sm font-bold text-white"
          >
            {initials(row.name)}
          </span>
          <div className="min-w-0">
            <p className="font-semibold">{row.name}</p>
            <p className="text-sm text-[var(--color-ink-soft)] break-all">{row.email}</p>
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-ink-soft)]">
              <Badge tone={row.pushDevices > 0 ? 'spring' : 'muted'}>
                {row.pushDevices > 0
                  ? `Notifications on (${row.pushDevices} ${row.pushDevices === 1 ? 'phone' : 'phones'})`
                  : 'Notifications off'}
              </Badge>
              {lastSignIn ? `Last signed in ${lastSignIn}` : 'Hasn’t signed in yet'}
            </p>
          </div>
        </div>
        {!resetting && (
          <div className="flex gap-2">
            <button type="button" onClick={startReset} disabled={busy} className={buttonClass('secondary', 'sm')}>
              Reset password
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className={buttonClass('danger', 'sm')}
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {resetting && (
        <form onSubmit={saveReset} className="mt-3 space-y-2">
          <PasswordField value={password} onChange={setPassword} />
          <p className="text-xs text-[var(--color-ink-soft)]">
            Saving signs {row.name.split(' ')[0]} out and stops notifications on
            every phone until they sign in with the new password.
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy ? 'Saving…' : 'Save new password'}
            </button>
            <button
              type="button"
              onClick={() => setResetting(false)}
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
