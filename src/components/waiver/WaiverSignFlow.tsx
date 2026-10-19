'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { clsx } from '@/lib/clsx';
import { siteConfig } from '@/lib/site-config';
import {
  GUARDIAN_RELATIONSHIPS,
  MINOR_ADDENDUM_TITLE,
  RELEASED_PARTY,
  WAIVER_VERSION,
  initialedSections,
  waiverDocument,
  waiverPlainText,
  type GuardianRelationship,
  type WaiverSection,
} from '@/lib/waiver/agreement';
import { ADULT_AGE, ageOn, initialsOf, waiverCoverage } from '@/lib/waiver/people';
import type { SignedSummary } from '@/lib/waiver/server';
import { SignaturePad, type SignatureValue } from './SignaturePad';

/*
 * Type sizes. § 744.301(3)(b), Florida Statutes, wants the minor notice in
 * uppercase type at least 5 points larger than all the waiver's other
 * text. 28px is 21pt; nothing else on this page is over 20px (15pt).
 * Don't add larger text here without raising NOTICE.
 */
const NOTICE = 'text-[28px] leading-[1.2]';

interface Props {
  bookingId: string;
  waiverKey: string;
  tourName: string;
  when: string;
  tripDate: string;
  /** Marina-local `YYYY-MM-DD`. */
  today: string;
  roster: Array<{ name: string; age: number | null }>;
  guestCount: number;
  signed: SignedSummary[];
}

interface MinorDraft {
  key: number;
  name: string;
  dob: string;
  rosterName: string | null;
  relationship: GuardianRelationship | null;
}

type Stamp = { initials: string; at: string };
type Errors = Record<string, string>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * When we can't tell whether a signature was saved. Signing again is safe:
 * the same person signing twice is counted once.
 */
const UNSURE_IF_SAVED =
  'We lost the connection, so we can’t tell if your waiver was saved. Check your email for your signed copy. If it hasn’t come in a few minutes, it’s fine to sign again: you won’t be counted twice.';
const EMPTY_SIGNER = { name: '', dob: '', email: '', phone: '', address: '' };

function fieldId(key: string) {
  return `w-${key.replace(/\./g, '-')}`;
}

function inputClass(error?: string) {
  return clsx(
    'h-12 w-full rounded-lg border bg-white px-3.5 text-base text-[var(--color-ink)] transition-colors',
    'placeholder:text-[var(--color-ink-soft)]/60 focus:outline-none focus:ring-2',
    error
      ? 'border-[var(--color-error)] focus:ring-[var(--color-error)]/20'
      : 'border-[var(--color-ink)]/20 focus:border-[var(--color-ink)] focus:ring-[var(--color-spring)]/20',
  );
}

/** Hex SHA-256 of the exact text this page rendered, sent with the signature. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

let nextMinorKey = 1;

export function WaiverSignFlow(props: Props) {
  const { bookingId, waiverKey, tourName, when, tripDate, today, roster, guestCount } = props;

  const [signedList, setSignedList] = useState(props.signed);
  const [signer, setSigner] = useState(EMPTY_SIGNER);
  // The roster guest they tapped. Kept while they correct the name to their
  // legal one ("Katie" → "Katherine"), and shown under the field with a "Not
  // me" to drop it, so someone who tapped the wrong name and typed their own
  // doesn't sign as that guest without seeing it.
  const [rosterName, setRosterName] = useState<string | null>(null);
  const [participating, setParticipating] = useState(true);
  const [minors, setMinors] = useState<MinorDraft[]>([]);
  const [guardian, setGuardian] = useState(false);
  const [accompanying, setAccompanying] = useState('');
  const [customInitials, setCustomInitials] = useState<string | null>(null);
  const [stamps, setStamps] = useState<Record<string, Stamp>>({});
  const [consent, setConsent] = useState(false);
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ copyUrl: string; name: string; email: string } | null>(null);
  const [round, setRound] = useState(0);

  const initials = (customInitials ?? initialsOf(signer.name)).toUpperCase();
  const withMinors = minors.length > 0;
  const doc = useMemo(() => waiverDocument({ withMinors }), [withMinors]);
  const required = useMemo(() => initialedSections(doc), [doc]);

  const coverage = useMemo(
    () =>
      waiverCoverage(
        roster,
        guestCount,
        signedList.map((s, i) => ({
          id: String(i),
          signer: { name: s.signer, participating: s.participating, rosterName: s.rosterName },
          minors: s.minors,
        })),
      ),
    [roster, guestCount, signedList],
  );
  const pickedHere = new Set([rosterName, ...minors.map((m) => m.rosterName)].filter(Boolean));
  const open = coverage.roster.filter((r) => !r.covered && !pickedHere.has(r.name));
  const adultChips = open.filter((r) => r.age == null || r.age >= ADULT_AGE);
  const minorChips = open.filter((r) => r.age != null && r.age < ADULT_AGE);

  const onSignature = useCallback((v: SignatureValue | null) => {
    setSignature(v);
    if (v) {
      setErrors((e) => {
        if (!('signature' in e)) return e;
        const next = { ...e };
        delete next.signature;
        return next;
      });
    }
  }, []);

  function clearError(...keys: string[]) {
    setErrors((e) => {
      if (!keys.some((k) => k in e)) return e;
      const next = { ...e };
      for (const k of keys) delete next[k];
      return next;
    });
  }

  function setSignerField(field: keyof typeof EMPTY_SIGNER, value: string) {
    setSigner((s) => ({ ...s, [field]: value }));
    if (field === 'name' && !value.trim()) setRosterName(null);
    clearError(`signer.${field}`);
  }

  function pickSigner(name: string) {
    setSigner((s) => ({ ...s, name }));
    setRosterName(name);
    clearError('signer.name');
  }

  function addMinor(name = '', fromRoster: string | null = null) {
    setMinors((list) => [
      ...list,
      { key: nextMinorKey++, name, dob: '', rosterName: fromRoster, relationship: null },
    ]);
    clearError('minors');
  }

  function updateMinor(key: number, patch: Partial<MinorDraft>) {
    setMinors((list) => list.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  }

  function removeMinor(key: number) {
    setMinors((list) => list.filter((m) => m.key !== key));
  }

  function stamp(sectionId: string) {
    // Initials are electronic signatures: consent to sign electronically
    // comes first.
    if (!consent) {
      setErrors((e) => ({
        ...e,
        [`initial.${sectionId}`]: 'First agree to sign electronically, at the top of this step.',
        consentElectronic: 'Agree to sign electronically before you initial, or ask Travis for a paper copy.',
      }));
      return;
    }
    if (!initials) {
      setErrors((e) => ({ ...e, [`initial.${sectionId}`]: 'Enter your name at the top first.' }));
      return;
    }
    setStamps((s) => ({ ...s, [sectionId]: { initials, at: new Date().toISOString() } }));
    clearError(`initial.${sectionId}`, 'initials');
  }

  function validate(): Errors {
    const e: Errors = {};
    if (signer.name.trim().length < 2) e['signer.name'] = 'Enter your full legal name.';
    if (!signer.dob) e['signer.dob'] = 'Enter your date of birth.';
    else if (signer.dob > today) e['signer.dob'] = 'Check your date of birth.';
    else if (ageOn(signer.dob, today) < ADULT_AGE)
      e['signer.dob'] =
        ageOn(signer.dob, tripDate) >= ADULT_AGE
          ? 'You turn 18 before the trip, so you sign your own waiver, once you’re 18. Come back to this link on or after your birthday.'
          : 'You need to be 18 or older to sign. A parent or legal guardian signs for anyone under 18.';
    if (!EMAIL_RE.test(signer.email.trim())) e['signer.email'] = 'Enter a valid email. Your signed copy goes there.';
    if (signer.phone.replace(/\D/g, '').length < 7) e['signer.phone'] = 'Enter a phone number.';
    if (signer.address.trim().length < 5) e['signer.address'] = 'Enter your home address.';

    minors.forEach((m, i) => {
      if (m.name.trim().length < 2) e[`minors.${i}.name`] = 'Enter the child’s full name.';
      if (!m.dob) e[`minors.${i}.dob`] = 'Enter the child’s date of birth.';
      else if (m.dob > today) e[`minors.${i}.dob`] = 'Check this date of birth.';
      else if (ageOn(m.dob, tripDate) >= ADULT_AGE)
        e[`minors.${i}.dob`] = 'They’ll be 18 or older on the trip date, so they sign their own waiver.';
      if (!m.relationship) e[`minors.${i}.relationship`] = 'Choose parent or legal guardian.';
    });
    if (!participating && minors.length === 0)
      e.minors = 'If you’re not going on the tour, add the child or children you’re signing for.';
    if (minors.length > 0 && !guardian)
      e.guardianAttested = 'Only a parent or legal guardian can sign for a child.';
    if (!participating && minors.length > 0 && accompanying.trim().length < 2)
      e.accompanyingAdult = 'Tell us which adult will be with your child on the boat.';

    const missing = required.filter((s) => stamps[s.id]?.initials !== initials || !initials);
    for (const s of missing) e[`initial.${s.id}`] = 'Initial this section.';
    if (missing.length > 0)
      e.initials =
        missing.length === 1 ? 'One section still needs your initials.' : `${missing.length} sections still need your initials.`;

    if (!consent) e.consentElectronic = 'Agree to sign electronically, or ask Travis for a paper form.';
    if (!signature) e.signature = 'Sign in the box with your finger, or type your signature.';
    return e;
  }

  function focusFirst(e: Errors) {
    const first = Object.keys(e).find((k) => document.getElementById(fieldId(k)));
    if (!first) return;
    const el = document.getElementById(fieldId(first));
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (el instanceof HTMLInputElement) el.focus({ preventScroll: true });
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      focusFirst(e);
      return;
    }

    let documentSha256: string;
    try {
      documentSha256 = await sha256Hex(waiverPlainText(doc));
    } catch {
      setFormError('This browser can’t sign securely. Open the link in an up-to-date browser, or ask Travis for a paper copy.');
      return;
    }

    const body = {
      bookingId,
      key: waiverKey,
      version: WAIVER_VERSION,
      documentSha256,
      signer: {
        name: signer.name.trim(),
        dob: signer.dob,
        email: signer.email.trim(),
        phone: signer.phone.trim(),
        address: signer.address.trim(),
        participating,
        rosterName,
      },
      minors: minors.map((m) => ({
        name: m.name.trim(),
        dob: m.dob,
        rosterName: m.rosterName,
        relationship: m.relationship!,
      })),
      accompanyingAdult: participating ? null : accompanying.trim(),
      guardianAttested: minors.length > 0 && guardian,
      initials: required
        .map((s) => ({ section: s.id, ...stamps[s.id]! }))
        .sort((a, b) => a.at.localeCompare(b.at)),
      consentElectronic: true,
      signaturePng: signature!.png,
      signatureMethod: signature!.method,
      clientSignedAt: new Date().toISOString(),
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    };

    setSubmitting(true);
    try {
      const res = await fetch('/api/waivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        field?: string;
        copyUrl?: string;
      };
      if (!res.ok || !data.copyUrl) {
        // A gateway error (502/504, no JSON) can come after the save went
        // through, so don't say it failed.
        const message =
          data.error ??
          (res.status >= 500 || res.ok
            ? UNSURE_IF_SAVED
            : 'Couldn’t save your waiver. Check your connection and try again.');
        if (data.field && document.getElementById(fieldId(data.field))) {
          const fe = { [data.field]: message };
          setErrors(fe);
          focusFirst(fe);
        } else {
          setFormError(message);
        }
        return;
      }
      setSignedList((list) => [
        ...list,
        {
          signer: body.signer.name,
          participating,
          rosterName,
          minors: body.minors.map((m) => ({ name: m.name, rosterName: m.rosterName })),
        },
      ]);
      setDone({ copyUrl: data.copyUrl, name: body.signer.name, email: body.signer.email });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      // The request may have reached the server and saved before the
      // connection dropped, so don't promise nothing was signed.
      setFormError(UNSURE_IF_SAVED);
    } finally {
      setSubmitting(false);
    }
  }

  function nextPerson() {
    setSigner(EMPTY_SIGNER);
    setRosterName(null);
    setParticipating(true);
    setMinors([]);
    setGuardian(false);
    setAccompanying('');
    setCustomInitials(null);
    setStamps({});
    setConsent(false);
    setSignature(null);
    setErrors({});
    setFormError(null);
    setDone(null);
    setRound((r) => r + 1);
    window.scrollTo({ top: 0 });
  }

  const header = (
    <header className="mb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-spring)]">
        Liability waiver
      </p>
      <h1 className="mt-1 text-[20px] font-bold leading-tight">{tourName}</h1>
      <p className="mt-0.5 text-[15px] text-[var(--color-ink-soft)]">{when}</p>
    </header>
  );

  if (done) {
    return (
      <div>
        {header}
        <Done
          name={done.name}
          email={done.email}
          copyUrl={done.copyUrl}
          when={when}
          coverage={coverage}
          onNextPerson={nextPerson}
        />
      </div>
    );
  }

  const errorCount = Object.keys(errors).filter((k) => !k.startsWith('initial.')).length;

  return (
    <form onSubmit={submit} noValidate>
      {header}

      <div className="mb-5 rounded-2xl bg-[var(--color-mist)] p-4 text-[15px] leading-relaxed">
        <p>
          <strong>Every adult on the boat signs their own waiver</strong> — one person can’t sign for
          another adult. A parent or legal guardian signs for anyone under 18. Takes about 3 minutes.
        </p>
        <p className="mt-2">
          This is a legal release: you give up the right to sue if you’re hurt. You don’t have to
          sign, but no one boards without a signed waiver. Rather sign on paper? Ask Travis; the paper
          copy has the same wording.
        </p>
        <PartyStatus coverage={coverage} />
      </div>

      <div className="space-y-5">
        {/* ---------------------------------------------------------------- */}
        <Card step={1} title="About you">
          {adultChips.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-sm font-medium">Tap your name</p>
              <div className="flex flex-wrap gap-2">
                {adultChips.map((r) => (
                  <Chip key={r.name} onClick={() => pickSigner(r.name)}>
                    {r.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="signer.name" label="Full legal name" error={errors['signer.name']} className="sm:col-span-2">
              <input
                id={fieldId('signer.name')}
                value={signer.name}
                onChange={(e) => setSignerField('name', e.target.value)}
                autoComplete="name"
                className={inputClass(errors['signer.name'])}
                aria-invalid={!!errors['signer.name']}
              />
              {rosterName && (
                <RosterPick lead="Signing as" name={rosterName} notThem="Not me" onDrop={() => setRosterName(null)} />
              )}
            </Field>
            <Field id="signer.dob" label="Date of birth" error={errors['signer.dob']}>
              <input
                id={fieldId('signer.dob')}
                type="date"
                value={signer.dob}
                max={today}
                onChange={(e) => setSignerField('dob', e.target.value)}
                autoComplete="bday"
                className={inputClass(errors['signer.dob'])}
                aria-invalid={!!errors['signer.dob']}
              />
            </Field>
            <Field id="signer.phone" label="Mobile phone" error={errors['signer.phone']}>
              <input
                id={fieldId('signer.phone')}
                type="tel"
                value={signer.phone}
                onChange={(e) => setSignerField('phone', e.target.value)}
                autoComplete="tel"
                className={inputClass(errors['signer.phone'])}
                aria-invalid={!!errors['signer.phone']}
              />
            </Field>
            <Field id="signer.email" label="Email (your signed copy goes here)" error={errors['signer.email']} className="sm:col-span-2">
              <input
                id={fieldId('signer.email')}
                type="email"
                inputMode="email"
                value={signer.email}
                onChange={(e) => setSignerField('email', e.target.value)}
                autoComplete="email"
                className={inputClass(errors['signer.email'])}
                aria-invalid={!!errors['signer.email']}
              />
            </Field>
            <Field id="signer.address" label="Home address" error={errors['signer.address']} className="sm:col-span-2">
              <input
                id={fieldId('signer.address')}
                value={signer.address}
                onChange={(e) => setSignerField('address', e.target.value)}
                autoComplete="street-address"
                placeholder="Street, city, state, ZIP"
                className={inputClass(errors['signer.address'])}
                aria-invalid={!!errors['signer.address']}
              />
            </Field>
          </div>

          <fieldset className="mt-5">
            <legend className="mb-2 text-sm font-medium">Are you going on this tour?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice checked={participating} onChange={() => setParticipating(true)} name="participating">
                Yes, I’m going
              </Choice>
              <Choice
                checked={!participating}
                onChange={() => {
                  setParticipating(false);
                  clearError('minors');
                }}
                name="participating"
              >
                No, I’m only signing for my kids
              </Choice>
            </div>
          </fieldset>
        </Card>

        {/* ---------------------------------------------------------------- */}
        <Card
          step={2}
          title={participating ? 'Kids under 18 you’re signing for' : 'Kids you’re signing for'}
          hint={
            participating
              ? 'Skip this if you’re not signing for anyone under 18.'
              : undefined
          }
        >
          <p className="text-[15px] leading-relaxed text-[var(--color-ink-soft)]">
            Only a child’s <strong className="text-[var(--color-ink)]">parent or court-appointed legal
            guardian</strong> can sign for them. Step-parents (unless they adopted the child),
            grandparents, aunts and uncles, and family friends can’t. Send this page’s link to the
            child’s parent instead; they can sign from home even if they aren’t coming.
          </p>

          {minorChips.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {minorChips.map((r) => (
                <Chip key={r.name} onClick={() => addMinor(r.name, r.name)}>
                  + {r.name}
                  <span className="text-[var(--color-ink-soft)]"> ({r.age})</span>
                </Chip>
              ))}
            </div>
          )}

          {minors.length > 0 && (
            <ul className="mt-4 space-y-3">
              {minors.map((m, i) => (
                <li key={m.key} className="rounded-xl border border-[var(--color-sand)] p-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
                    <Field id={`minors.${i}.name`} label="Child’s full name" error={errors[`minors.${i}.name`]}>
                      <input
                        id={fieldId(`minors.${i}.name`)}
                        value={m.name}
                        onChange={(e) => {
                          const name = e.target.value;
                          updateMinor(m.key, name.trim() ? { name } : { name, rosterName: null });
                          clearError(`minors.${i}.name`);
                        }}
                        className={inputClass(errors[`minors.${i}.name`])}
                        aria-invalid={!!errors[`minors.${i}.name`]}
                      />
                      {m.rosterName && (
                        <RosterPick
                          lead="Signing for"
                          name={m.rosterName}
                          notThem="Not this child"
                          onDrop={() => updateMinor(m.key, { rosterName: null })}
                        />
                      )}
                    </Field>
                    <Field id={`minors.${i}.dob`} label="Date of birth" error={errors[`minors.${i}.dob`]}>
                      <input
                        id={fieldId(`minors.${i}.dob`)}
                        type="date"
                        value={m.dob}
                        max={today}
                        onChange={(e) => {
                          updateMinor(m.key, { dob: e.target.value });
                          clearError(`minors.${i}.dob`);
                        }}
                        className={inputClass(errors[`minors.${i}.dob`])}
                        aria-invalid={!!errors[`minors.${i}.dob`]}
                      />
                    </Field>
                  </div>
                  <fieldset className="mt-3">
                    <legend className="mb-1.5 text-sm font-medium">You are this child’s</legend>
                    <div className="grid gap-2 sm:grid-cols-2" id={fieldId(`minors.${i}.relationship`)}>
                      {(Object.keys(GUARDIAN_RELATIONSHIPS) as GuardianRelationship[]).map((r) => (
                        <Choice
                          key={r}
                          name={`relationship-${m.key}`}
                          checked={m.relationship === r}
                          onChange={() => {
                            updateMinor(m.key, { relationship: r });
                            clearError(`minors.${i}.relationship`);
                          }}
                        >
                          {GUARDIAN_RELATIONSHIPS[r]}
                        </Choice>
                      ))}
                    </div>
                    {errors[`minors.${i}.relationship`] && (
                      <ErrorText id={`minors.${i}.relationship`}>{errors[`minors.${i}.relationship`]}</ErrorText>
                    )}
                  </fieldset>
                  <button
                    type="button"
                    onClick={() => removeMinor(m.key)}
                    className="mt-2 text-sm font-medium text-[var(--color-ink-soft)] underline underline-offset-2 hover:text-[var(--color-ink)]"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            id={fieldId('minors')}
            onClick={() => addMinor()}
            className="mt-4 inline-flex h-11 items-center rounded-lg border border-dashed border-[var(--color-ink)]/30 px-4 text-sm font-semibold hover:border-[var(--color-ink)]"
          >
            + Add a child
          </button>
          {errors.minors && <ErrorText id="minors">{errors.minors}</ErrorText>}

          {minors.length > 0 && (
            <div className="mt-5 space-y-4">
              {!participating && (
                <Field
                  id="accompanyingAdult"
                  label="Adult who’ll be with them on the boat"
                  error={errors.accompanyingAdult}
                >
                  <input
                    id={fieldId('accompanyingAdult')}
                    value={accompanying}
                    onChange={(e) => {
                      setAccompanying(e.target.value);
                      clearError('accompanyingAdult');
                    }}
                    className={inputClass(errors.accompanyingAdult)}
                    aria-invalid={!!errors.accompanyingAdult}
                  />
                </Field>
              )}
              <Check
                id="guardianAttested"
                checked={guardian}
                error={errors.guardianAttested}
                onChange={(v) => {
                  setGuardian(v);
                  clearError('guardianAttested');
                }}
              >
                I’m the parent or legal guardian of{' '}
                {minors.length === 1 ? 'this child' : `each of these ${minors.length} children`}.
              </Check>
            </div>
          )}
        </Card>

        {/* ---------------------------------------------------------------- */}
        <Card step={3} title="Read and initial the waiver">
          <Check
            id="consentElectronic"
            checked={consent}
            error={errors.consentElectronic}
            onChange={(v) => {
              setConsent(v);
              // Withdrawing consent withdraws the initials given under it.
              if (!v) setStamps({});
              clearError('consentElectronic');
            }}
          >
            {doc.esignConsent}
          </Check>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--color-ink-soft)]">
            Tap <strong className="text-[var(--color-ink)]">Initial</strong> after each section to
            show you’ve read it. Can’t truthfully agree to the health statement? Call or text Travis at{' '}
            <a href={siteConfig.contact.phoneHref} className="font-medium text-[var(--color-ink)] underline underline-offset-2">
              {siteConfig.contact.phone}
            </a>{' '}
            before you sign.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <label htmlFor={fieldId('initials-text')} className="text-sm font-medium">
              Your initials
            </label>
            <input
              id={fieldId('initials-text')}
              value={initials}
              onChange={(e) =>
                setCustomInitials(e.target.value.replace(/[^\p{L}]/gu, '').slice(0, 4).toUpperCase())
              }
              placeholder="—"
              className="h-10 w-20 rounded-lg border border-[var(--color-ink)]/20 bg-white px-3 text-center text-base font-bold uppercase tracking-wider focus:border-[var(--color-ink)] focus:outline-none"
            />
          </div>

          <article className="mt-5 border-t border-[var(--color-sand)] pt-5 text-[15px] leading-relaxed">
            <h2 className="text-[18px] font-bold uppercase leading-snug">{doc.title}</h2>
            <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
              {RELEASED_PARTY} · version {doc.version}
            </p>
            {doc.sections.map((s) => (
              <DocSection
                key={s.id}
                section={s}
                stamp={stamps[s.id]}
                currentInitials={initials}
                error={errors[`initial.${s.id}`]}
                onInitial={() => stamp(s.id)}
              />
            ))}

            {doc.minorAddendum && (
              <div className="mt-8 border-t-2 border-[var(--color-ink)] pt-5">
                <h2 className="text-[18px] font-bold uppercase leading-snug">{MINOR_ADDENDUM_TITLE}</h2>
                <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                  For each participant under 18. Section 744.301(3), Florida Statutes.
                </p>
                {doc.minorAddendum.map((s) => (
                  <DocSection
                    key={s.id}
                    section={s}
                    stamp={stamps[s.id]}
                    currentInitials={initials}
                    error={errors[`initial.${s.id}`]}
                    onInitial={() => stamp(s.id)}
                  />
                ))}
                <p className="mt-3 text-[15px]">
                  <strong>Children covered:</strong>{' '}
                  {minors.map((m) => m.name.trim() || 'unnamed child').join(', ')}
                </p>
              </div>
            )}
          </article>
          {errors.initials && <ErrorText id="initials">{errors.initials}</ErrorText>}
        </Card>

        {/* ---------------------------------------------------------------- */}
        <Card step={4} title="Sign">
          <p className="text-[15px] font-semibold leading-relaxed">{doc.attestation}</p>

          <div className="mt-4" id={fieldId('signature')}>
            <SignaturePad key={round} typedName={signer.name} onChange={onSignature} invalid={!!errors.signature} />
            {errors.signature && <ErrorText id="signature-msg">{errors.signature}</ErrorText>}
          </div>
          <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
            Signing as <strong className="text-[var(--color-ink)]">{signer.name.trim() || '…'}</strong>
            {withMinors && ', for yourself and as parent or legal guardian of the children above'}.
          </p>

          {formError && (
            <div role="alert" className="mt-4 rounded-xl border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 px-4 py-3 text-sm">
              {formError}
            </div>
          )}
          {errorCount > 0 && (
            <p role="alert" className="mt-4 text-sm font-medium text-[var(--color-error)]">
              {errorCount === 1 ? 'One thing to fix above.' : `${errorCount} things to fix above.`}
            </p>
          )}

          <Button type="submit" size="lg" className="mt-5 w-full" disabled={submitting}>
            {submitting ? 'Signing…' : 'Sign waiver'}
          </Button>
        </Card>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function PartyStatus({ coverage }: { coverage: ReturnType<typeof waiverCoverage> }) {
  // An old-site booking with no party size on file has no "of": only a
  // count once someone signs.
  if (coverage.needed === 0 && coverage.signedCount === 0) return null;
  return (
    <div className="mt-3 border-t border-[var(--color-spring)]/15 pt-3">
      <p className="text-sm font-semibold">
        {coverage.needed === 0
          ? `${coverage.signedCount} signed so far`
          : `${coverage.signedCount} of ${coverage.needed} on this booking signed`}
      </p>
      {coverage.roster.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-sm">
          {coverage.roster.map((r, i) => (
            <li key={i} className="flex items-center gap-2">
              <span
                aria-hidden
                className={clsx(
                  'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  r.covered ? 'bg-[var(--color-spring)] text-white' : 'border border-[var(--color-ink)]/30',
                )}
              >
                {r.covered ? '✓' : ''}
              </span>
              <span>
                {r.name}
                <span className="sr-only">{r.covered ? ', signed' : ', not signed yet'}</span>
                {r.covered?.minor && (
                  <span className="text-[var(--color-ink-soft)]"> · signed by {r.covered.signerName}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Done({
  name,
  email,
  copyUrl,
  when,
  coverage,
  onNextPerson,
}: {
  name: string;
  email: string;
  copyUrl: string;
  when: string;
  coverage: ReturnType<typeof waiverCoverage>;
  onNextPerson: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const missing = coverage.roster.filter((r) => !r.covered);
  // Guests the booking never named who still need to sign.
  const unnamed = Math.max(0, coverage.needed - coverage.signedCount - missing.length);
  const shareText = `Please sign the waiver for our manatee tour (${when}). Every adult signs their own; parents sign for kids.`;

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Manatee tour waiver', text: shareText, url });
      } catch {
        /* closed the share sheet */
      }
      return;
    }
    await copy();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked; the address bar still has the link */
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-[var(--color-spring-deep)] p-6 text-white">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-buoy)] text-[var(--color-ink)]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M5 12.5l4 4 10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="mt-4 text-[20px] font-bold leading-tight">Signed. Thanks, {name.split(' ')[0]}!</h2>
        <p className="mt-2 text-white/85">
          A copy is on its way to <span className="font-medium text-white">{email}</span>.
        </p>
        <a
          href={copyUrl}
          target="_blank"
          rel="noopener"
          className="mt-4 inline-flex h-11 items-center rounded-[10px] bg-white px-4 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-mist)]"
        >
          Download your signed copy (PDF)
        </a>
      </div>

      <div className="rounded-2xl border border-[var(--color-sand)] bg-white p-5">
        <h2 className="text-[18px] font-bold">
          {coverage.complete ? 'Everyone on the booking has signed' : 'Who still needs to sign'}
        </h2>
        {!coverage.complete ? (
          <>
            {missing.length + unnamed > 0 && (
              <ul className="mt-2 list-disc pl-5 text-[15px]">
                {missing.map((r, i) => (
                  <li key={i}>
                    {r.name}
                    {r.age != null && r.age < ADULT_AGE && (
                      <span className="text-[var(--color-ink-soft)]"> (under 18: their parent signs)</span>
                    )}
                  </li>
                ))}
                {unnamed > 0 && (
                  <li>
                    {`${unnamed} ${missing.length > 0 ? 'more ' : ''}${unnamed === 1 ? 'person' : 'people'} in your party`}
                  </li>
                )}
              </ul>
            )}
            {coverage.needed === 0 && (
              <p className="mt-2 text-[15px]">
                Everyone else in your party. We don’t have your party size on file, so we can’t
                tell how many that is.
              </p>
            )}
            <p className="mt-3 text-[15px] text-[var(--color-ink-soft)]">
              Send them this page’s link. Each adult signs on their own phone.
            </p>
          </>
        ) : (
          <p className="mt-2 text-[15px] text-[var(--color-ink-soft)]">
            You’re all set. See you at {siteConfig.marina.name}.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={share} variant="dark">
            Share the waiver link
          </Button>
          <Button type="button" onClick={copy} variant="outline">
            {copied ? 'Link copied' : 'Copy link'}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--color-sand)] bg-white p-5">
        <h2 className="text-[18px] font-bold">Someone else signing on this phone?</h2>
        <p className="mt-1 text-[15px] text-[var(--color-ink-soft)]">
          Hand it over and start a fresh waiver for them.
        </p>
        <Button type="button" onClick={onNextPerson} variant="outline" className="mt-3">
          Start the next person’s waiver
        </Button>
      </div>
    </div>
  );
}

function DocSection({
  section,
  stamp,
  currentInitials,
  error,
  onInitial,
}: {
  section: WaiverSection;
  stamp: Stamp | undefined;
  currentInitials: string;
  error?: string;
  onInitial: () => void;
}) {
  if (section.statutoryNotice) {
    return (
      <div className="my-6 rounded-lg border-[3px] border-[var(--color-ink)] p-4">
        <p className={clsx(NOTICE, 'font-extrabold uppercase break-words')}>{section.heading}</p>
        {section.paragraphs.map((p, i) => (
          <p key={i} className={clsx(NOTICE, 'mt-3 font-extrabold uppercase break-words')}>
            {p}
          </p>
        ))}
      </div>
    );
  }

  if (section.callout) {
    return (
      <div className="mt-5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-mist)] p-4">
        {section.heading && <h3 className="text-[16px] font-bold uppercase">{section.heading}</h3>}
        {section.paragraphs.map((p, i) => (
          <p key={i} className="mt-2 font-semibold">
            {p}
          </p>
        ))}
      </div>
    );
  }

  const stale = stamp && stamp.initials !== currentInitials;
  return (
    <section className="mt-5">
      {section.heading && <h3 className="mb-1.5 text-[16px] font-bold">{section.heading}</h3>}
      {section.paragraphs.map((p, i) => (
        <p key={i} className="mt-2 first:mt-0">
          {p}
        </p>
      ))}
      {section.items && (
        <ol className="mt-2 space-y-1">
          {section.items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-7 shrink-0 tabular-nums text-[var(--color-ink-soft)]">({i + 1})</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      )}
      {section.after?.map((p, i) => (
        <p key={i} className="mt-2">
          {p}
        </p>
      ))}
      {section.initials && (
        <div className="mt-3 flex justify-end">
          {stamp && !stale ? (
            <span className="inline-flex items-center gap-2 rounded-lg border-2 border-[var(--color-spring)] bg-[var(--color-mist)] px-3 py-1.5 text-sm">
              <span className="font-bold tracking-wider">{stamp.initials}</span>
              <span className="text-[var(--color-ink-soft)]">initialed {timeOf(stamp.at)}</span>
            </span>
          ) : (
            <div className="text-right">
              <button
                type="button"
                id={fieldId(`initial.${section.id}`)}
                onClick={onInitial}
                className={clsx(
                  'inline-flex h-11 items-center gap-2 rounded-lg border-2 px-4 text-sm font-semibold',
                  error
                    ? 'border-[var(--color-error)] text-[var(--color-error)]'
                    : 'border-[var(--color-ink)] hover:bg-[var(--color-ink)] hover:text-white',
                )}
              >
                Initial{currentInitials ? ` (${currentInitials})` : ''}
              </button>
              {(error || stale) && (
                <p className="mt-1 text-sm text-[var(--color-error)]">
                  {stale ? 'Your initials changed. Initial again.' : error}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Card({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--color-sand)] bg-white p-5 sm:p-7">
      <h2 className="flex items-baseline gap-2 text-[18px] font-bold">
        <span className="text-sm font-semibold text-[var(--color-spring)]">{step}.</span>
        {title}
      </h2>
      {hint && <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  error,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={fieldId(id)} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error && <ErrorText id={id}>{error}</ErrorText>}
    </div>
  );
}

/** The roster guest a name field is linked to, with a way to unlink it. */
function RosterPick({
  lead,
  name,
  notThem,
  onDrop,
}: {
  lead: string;
  name: string;
  notThem: string;
  onDrop: () => void;
}) {
  return (
    <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
      {lead} <strong className="font-semibold text-[var(--color-ink)]">{name}</strong>, as listed on the booking ·{' '}
      <button
        type="button"
        onClick={onDrop}
        className="font-medium underline underline-offset-2 hover:text-[var(--color-ink)]"
      >
        {notThem}
      </button>
    </p>
  );
}

function ErrorText({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={`${fieldId(id)}-error`} className="mt-1.5 text-sm text-[var(--color-error)]">
      {children}
    </p>
  );
}

function Check({
  id,
  checked,
  onChange,
  error,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        className={clsx(
          'flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors',
          checked
            ? 'border-[var(--color-spring)]/40 bg-[var(--color-mist)]/60'
            : error
              ? 'border-[var(--color-error)]/50'
              : 'border-[var(--color-sand)] hover:border-[var(--color-ink)]/30',
        )}
      >
        <input
          id={fieldId(id)}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={!!error}
          className="mt-0.5 h-5 w-5 shrink-0 rounded accent-[var(--color-spring)]"
        />
        <span className="text-[15px] leading-relaxed">{children}</span>
      </label>
      {error && <ErrorText id={id}>{error}</ErrorText>}
    </div>
  );
}

function Choice({
  checked,
  onChange,
  name,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  name: string;
  children: ReactNode;
}) {
  return (
    <label
      className={clsx(
        'flex h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 text-[15px] font-medium transition-colors',
        checked
          ? 'border-[var(--color-spring)] bg-[var(--color-mist)]/60'
          : 'border-[var(--color-sand)] hover:border-[var(--color-ink)]/30',
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-[var(--color-spring)]"
      />
      {children}
    </label>
  );
}

function Chip({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center rounded-full border border-[var(--color-ink)]/20 bg-white px-4 text-sm font-medium hover:border-[var(--color-ink)]"
    >
      {children}
    </button>
  );
}
