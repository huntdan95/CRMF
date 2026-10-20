import type { Metadata } from 'next';
import { siteConfig } from '@/lib/site-config';
import { pageSeo } from '@/lib/seo';
import {
  MINOR_ADDENDUM_TITLE,
  RELEASED_PARTY,
  waiverDocument,
  type WaiverSection,
} from '@/lib/waiver/agreement';

const title = 'Liability waiver';
const description = 'The liability waiver every guest signs before a Crystal River Manatee Fun tour.';

export const metadata: Metadata = {
  title,
  description,
  ...pageSeo('/waiver', { title, description }),
};

/*
 * Same sizes as the signing page (WaiverSignFlow): the § 744.301(3) notice
 * stays at least 5 points larger than everything else in the waiver.
 */
const NOTICE = 'text-[28px] leading-[1.2]';

/**
 * /waiver — the full waiver, to read before booking. Signing happens at
 * /waiver/{booking} from the confirmation email; this page signs nothing.
 */
export default function WaiverPreviewPage() {
  const doc = waiverDocument({ withMinors: true });
  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-6 sm:px-6 sm:pt-10">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-spring)]">
        Liability waiver
      </p>
      <h1 className="mt-1 text-[20px] font-bold leading-tight">Read the waiver before you book</h1>
      <div className="mt-4 rounded-2xl bg-[var(--color-mist)] p-4 text-[15px] leading-relaxed">
        <p>
          Every adult on the boat signs this waiver for themselves before the tour, on their phone,
          from the link in the booking confirmation. A parent or legal guardian signs the Florida
          Minor Participant Addendum for anyone under 18. No one boards without a signed waiver.
        </p>
        <p className="mt-2">
          Rather sign on paper? Ask Travis at{' '}
          <a href={siteConfig.contact.phoneHref} className="font-medium underline underline-offset-2">
            {siteConfig.contact.phone}
          </a>
          ; the paper copy has the same wording.
        </p>
      </div>

      <article className="mt-6 rounded-2xl border border-[var(--color-sand)] bg-white p-5 text-[15px] leading-relaxed sm:p-7">
        <h2 className="text-[18px] font-bold uppercase leading-snug">{doc.title}</h2>
        <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
          {RELEASED_PARTY} · version {doc.version}
        </p>
        {doc.sections.map((s) => (
          <Section key={s.id} section={s} />
        ))}
        {doc.minorAddendum && (
          <div className="mt-8 border-t-2 border-[var(--color-ink)] pt-5">
            <h2 className="text-[18px] font-bold uppercase leading-snug">{MINOR_ADDENDUM_TITLE}</h2>
            <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
              For each participant under 18. Section 744.301(3), Florida Statutes.
            </p>
            {doc.minorAddendum.map((s) => (
              <Section key={s.id} section={s} />
            ))}
          </div>
        )}
        <p className="mt-6">{doc.esignConsent}</p>
        <p className="mt-3 font-semibold">{doc.attestation}</p>
      </article>
    </div>
  );
}

function Section({ section }: { section: WaiverSection }) {
  if (section.statutoryNotice) {
    return (
      <div className="my-6 rounded-lg border-[3px] border-[var(--color-ink)] p-4">
        <p className={`${NOTICE} break-words font-extrabold uppercase`}>{section.heading}</p>
        {section.paragraphs.map((p, i) => (
          <p key={i} className={`${NOTICE} mt-3 break-words font-extrabold uppercase`}>
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
        <p className="mt-2 text-right text-sm text-[var(--color-ink-soft)]">Initialed when signing</p>
      )}
    </section>
  );
}
