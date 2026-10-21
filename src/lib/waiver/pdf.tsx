import 'server-only';
import React from 'react';
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import {
  GUARDIAN_RELATIONSHIPS,
  MINOR_ADDENDUM_TITLE,
  RELEASED_PARTY,
  WAIVER_BASED_ON,
  type WaiverDocument,
  type WaiverSection,
} from './agreement';
import { SANS } from './fonts';
import type { SignedWaiver } from './types';

/*
 * Type sizes. § 744.301(3)(b) wants the minor notice in uppercase type at
 * least 5 points larger than all the waiver's other text, so nothing else
 * in this document may be larger than NOTICE_SIZE - 5.
 */
const BODY_SIZE = 9;
const HEADING_SIZE = 10;
const TITLE_SIZE = 12;
const NOTICE_SIZE = 18;

/*
 * Fonts: see ./fonts, which registers them and checks what they can print.
 * A name they can't print is printed in the Latin letters the signer gave
 * for it (`latinName` on the record).
 */

const ink = '#0E201E';
const soft = '#4B5D59';
const rule = '#C9C3B4';

const s = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingBottom: 54,
    paddingHorizontal: 44,
    fontFamily: SANS,
    fontSize: BODY_SIZE,
    lineHeight: 1.4,
    color: ink,
  },
  runningHead: {
    position: 'absolute',
    top: 24,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: soft,
  },
  title: { fontWeight: 'bold', fontSize: TITLE_SIZE, textAlign: 'center', marginBottom: 2 },
  subtitle: { textAlign: 'center', color: soft, marginBottom: 12 },
  box: { borderWidth: 0.75, borderColor: rule, borderRadius: 3, padding: 8, marginBottom: 10 },
  label: { fontSize: 7, color: soft, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', marginBottom: 5, paddingRight: 8 },
  cellWide: { width: '100%', marginBottom: 5 },
  heading: { fontWeight: 'bold', fontSize: HEADING_SIZE, marginTop: 8, marginBottom: 3 },
  para: { marginBottom: 4, textAlign: 'justify' },
  item: { flexDirection: 'row', marginBottom: 2 },
  itemNum: { width: 20 },
  itemText: { flex: 1, textAlign: 'justify' },
  initials: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    borderWidth: 0.75,
    borderColor: ink,
    borderRadius: 2,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginTop: 2,
    marginBottom: 4,
  },
  initialsMark: { fontWeight: 'bold', marginRight: 6 },
  callout: { borderWidth: 1.5, borderColor: ink, padding: 8, marginVertical: 6 },
  calloutHeading: { fontWeight: 'bold', fontSize: HEADING_SIZE, textTransform: 'uppercase', marginBottom: 3 },
  calloutText: { fontWeight: 'bold', marginBottom: 3 },
  blankLine: { borderBottomWidth: 0.75, borderColor: ink, height: 18, marginBottom: 6 },
  notice: {
    borderWidth: 2,
    borderColor: ink,
    padding: 10,
    marginVertical: 8,
  },
  noticeText: {
    fontWeight: 'bold',
    fontSize: NOTICE_SIZE,
    lineHeight: 1.25,
    textTransform: 'uppercase',
  },
  addendumTitle: { fontWeight: 'bold', fontSize: TITLE_SIZE, marginTop: 14, marginBottom: 2 },
  tableHead: { flexDirection: 'row', borderBottomWidth: 0.75, borderColor: ink, paddingBottom: 2, marginBottom: 2 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: rule, paddingVertical: 3 },
  th: { fontWeight: 'bold' },
  signature: { height: 64, objectFit: 'contain', objectPosition: 'left', marginBottom: 2 },
  sigLine: { borderTopWidth: 0.75, borderColor: ink, paddingTop: 2, width: 260 },
  auditRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: rule, paddingVertical: 3 },
  auditKey: { width: 130, color: soft },
  auditVal: { flex: 1, fontSize: 8 },
  latinNote: { fontSize: 7, color: soft, marginTop: 2 },
  // Only for values the server makes (IDs, hashes): Courier is ASCII-only.
  mono: { fontFamily: 'Courier' },
});

export interface WaiverPdfInput {
  record: Omit<SignedWaiver, 'signedAt' | 'pdfSha256' | 'emailedAt' | 'copyTokenSha256'> & {
    signedAtIso: string;
  };
  doc: WaiverDocument;
  /** `data:image/png;base64,…` */
  signaturePng: string;
  tripWhen: string;
}

/** "Oct 13, 2026, 9:14:03 AM EDT" in Crystal River time. */
export function marinaTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

/** The name the PDF prints: the Latin version when its fonts can't print the one typed. */
function printedName(p: { name: string; latinName?: string | null }): string {
  return p.latinName ?? p.name;
}

/** "Kim Minjun *": a name printed in its Latin version, which LatinNote explains. */
function markedName(p: { name: string; latinName?: string | null }): string {
  return p.latinName ? `${p.latinName} *` : p.name;
}

/** "U+AE40 U+BBFC U+C900": a name the fonts can't draw, spelled out so the PDF still pins it down. */
function codePoints(text: string): string {
  return Array.from(text, (ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
}

function LatinNote() {
  return (
    <Text style={s.latinNote}>
      * In English letters, as the signer gave it: this PDF can’t print the name as typed. The signed
      record keeps the name exactly as typed; the Electronic signature record page spells it out.
    </Text>
  );
}

function friendlyDob(dob: string): string {
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <View style={wide ? s.cellWide : s.cell}>
      <Text style={s.label}>{label}</Text>
      <Text>{value || '—'}</Text>
    </View>
  );
}

function Section({
  section,
  initials,
}: {
  section: WaiverSection;
  /** 'blank' on the paper copy: a line to initial by hand. */
  initials: { initials: string; at: string } | 'blank' | undefined;
}) {
  if (section.statutoryNotice) {
    return (
      <View style={s.notice} wrap={false}>
        <Text style={s.noticeText}>{section.heading}</Text>
        {section.paragraphs.map((p, i) => (
          <Text key={i} style={s.noticeText}>
            {p}
          </Text>
        ))}
      </View>
    );
  }
  if (section.callout) {
    return (
      <View style={s.callout} wrap={false}>
        {section.heading && <Text style={s.calloutHeading}>{section.heading}</Text>}
        {section.paragraphs.map((p, i) => (
          <Text key={i} style={s.calloutText}>
            {p}
          </Text>
        ))}
      </View>
    );
  }
  return (
    <View>
      {section.heading && <Text style={s.heading}>{section.heading}</Text>}
      {section.paragraphs.map((p, i) => (
        <Text key={i} style={s.para}>
          {p}
        </Text>
      ))}
      {section.items?.map((item, i) => (
        <View key={i} style={s.item}>
          <Text style={s.itemNum}>({i + 1})</Text>
          <Text style={s.itemText}>{item}</Text>
        </View>
      ))}
      {section.after?.map((p, i) => (
        <Text key={i} style={[s.para, { marginTop: i === 0 ? 4 : 0 }]}>
          {p}
        </Text>
      ))}
      {section.initials &&
        (initials === 'blank' ? (
          <View style={s.initials} wrap={false}>
            <Text style={s.initialsMark}>Initials: ________</Text>
          </View>
        ) : (
          <View style={s.initials} wrap={false}>
            <Text style={s.initialsMark}>Initials: {initials?.initials ?? '—'}</Text>
            <Text style={{ color: soft }}>{initials ? marinaTime(initials.at) : 'not initialed'}</Text>
          </View>
        ))}
    </View>
  );
}

function AuditRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <View style={s.auditRow} wrap={false}>
      <Text style={s.auditKey}>{k}</Text>
      <Text style={mono ? [s.auditVal, s.mono] : s.auditVal}>{v}</Text>
    </View>
  );
}

function SignedWaiverDocument({ record, doc, signaturePng, tripWhen }: WaiverPdfInput) {
  const initialsBySection = new Map(record.initials.map((i) => [i.section, i]));
  const running = (
    <View style={s.runningHead} fixed>
      <Text>
        {RELEASED_PARTY} · Signed liability waiver · version {doc.version} (based on {WAIVER_BASED_ON})
      </Text>
      <Text
        render={({ pageNumber, totalPages }) => `Waiver ${record.id} · page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );

  return (
    <Document
      title={`Signed waiver — ${record.signer.name} — ${record.tripDate}`}
      author={RELEASED_PARTY}
      subject={doc.title}
    >
      <Page size="LETTER" style={s.page}>
        {running}
        <Text style={s.title}>{doc.title.toUpperCase()}</Text>
        <Text style={s.subtitle}>{RELEASED_PARTY}</Text>

        <View style={s.box}>
          <View style={s.grid}>
            <Field label="Charter" value={record.tourName} />
            <Field label="Date and time" value={tripWhen} />
            <Field label="Participant / signer" value={markedName(record.signer)} />
            <Field label="Date of birth" value={friendlyDob(record.signer.dob)} />
            <Field label="Email" value={record.signer.email} />
            <Field label="Phone" value={record.signer.phone} />
            <Field label="Address" value={record.signer.address} wide />
            <Field
              label="Going on the charter"
              value={
                record.signer.participating
                  ? 'Yes'
                  : 'No — signing only for the minor(s) named in the Addendum'
              }
              wide
            />
          </View>
          {record.signer.latinName && <LatinNote />}
        </View>

        {doc.sections.map((section) => (
          <Section key={section.id} section={section} initials={initialsBySection.get(section.id)} />
        ))}

        {doc.minorAddendum && (
          <View break>
            <Text style={s.addendumTitle}>{MINOR_ADDENDUM_TITLE.toUpperCase()}</Text>
            <Text style={{ color: soft, marginBottom: 4 }}>
              Required for each participant under 18 years of age. Section 744.301(3), Florida Statutes.
            </Text>
            {doc.minorAddendum.map((section) => (
              <Section
                key={section.id}
                section={section}
                initials={initialsBySection.get(section.id)}
              />
            ))}

            <Text style={s.heading}>Minor children covered by this Addendum</Text>
            <View style={s.tableHead}>
              <Text style={[s.th, { flex: 3 }]}>Name</Text>
              <Text style={[s.th, { flex: 2 }]}>Date of birth</Text>
              <Text style={[s.th, { flex: 1 }]}>Age on trip</Text>
              <Text style={[s.th, { flex: 2 }]}>Signer is the child’s</Text>
            </View>
            {record.minors.map((m, i) => (
              <View key={i} style={s.tableRow} wrap={false}>
                <Text style={{ flex: 3 }}>{markedName(m)}</Text>
                <Text style={{ flex: 2 }}>{friendlyDob(m.dob)}</Text>
                <Text style={{ flex: 1 }}>{String(m.ageOnTripDate)}</Text>
                <Text style={{ flex: 2 }}>
                  {m.relationship ? GUARDIAN_RELATIONSHIPS[m.relationship] : 'Parent or legal guardian'}
                </Text>
              </View>
            ))}
            {record.minors.some((m) => m.latinName) && <LatinNote />}
            <View style={{ marginTop: 6 }}>
              <Text>
                Signed for the minor(s) by: {printedName(record.signer)}
                {record.guardianAttested ? ' (attested to the relationship shown for each child)' : ''}
              </Text>
              {record.accompanyingAdult && (
                <Text>Adult supervising the minor(s) on the charter: {record.accompanyingAdult}</Text>
              )}
            </View>
          </View>
        )}

        <View wrap={false} style={{ marginTop: 12 }}>
          <Text style={s.para}>{doc.esignConsent}</Text>
          <Text style={[s.para, { fontWeight: 'bold' }]}>{doc.attestation}</Text>
          {/* react-pdf's Image has no alt text. */}
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={signaturePng} style={s.signature} />
          <View style={s.sigLine}>
            <Text>
              Signature of {printedName(record.signer)}
              {!record.signer.participating
                ? ', parent/guardian'
                : record.minors.length > 0
                  ? ', participant and parent/guardian'
                  : ', participant'}
            </Text>
            <Text style={{ color: soft }}>Signed {marinaTime(record.signedAtIso)}</Text>
          </View>
        </View>
      </Page>

      <Page size="LETTER" style={s.page}>
        {running}
        <Text style={[s.title, { textAlign: 'left' }]}>Electronic signature record</Text>
        <Text style={{ color: soft, marginBottom: 10 }}>
          Recorded by the {RELEASED_PARTY} booking system when this waiver was signed. The document
          hash identifies the exact wording shown to the signer; the record hash covers every value on
          this page.
        </Text>
        <AuditRow k="Waiver ID" v={record.id} mono />
        <AuditRow k="Booking" v={record.bookingId} mono />
        <AuditRow k="Trip" v={`${record.tripId} · ${record.tourName}`} />
        <AuditRow k="Signed (server)" v={`${marinaTime(record.signedAtIso)} · ${record.signedAtIso}`} />
        <AuditRow k="Signer's device clock" v={record.clientSignedAt} />
        <AuditRow k="Signer's time zone" v={record.clientTimeZone ?? '—'} />
        <AuditRow k="IP address" v={record.ip ?? '—'} />
        <AuditRow k="Device / browser" v={record.userAgent ?? '—'} />
        {[{ who: 'Signer', p: record.signer }, ...record.minors.map((p) => ({ who: 'Minor', p }))]
          .filter(({ p }) => p.latinName)
          .map(({ who, p }, i) => (
            <AuditRow
              key={i}
              k={`${who}’s name as typed`}
              v={`${codePoints(p.name)} (Unicode). Printed in this PDF as ${p.latinName}.`}
            />
          ))}
        <AuditRow k="Email" v={record.signer.email} />
        <AuditRow k="Phone" v={record.signer.phone} />
        <AuditRow k="Consent to e-sign" v={record.consentElectronic ? 'Yes — checked before signing' : 'No'} />
        <AuditRow
          k="Guardian attestation"
          v={
            record.minors.length === 0
              ? 'n/a — no minors'
              : record.guardianAttested
                ? 'Yes — confirmed parent or legal guardian of each minor'
                : 'No'
          }
        />
        <AuditRow k="Document version" v={`${record.version} (based on ${WAIVER_BASED_ON})`} />
        <AuditRow
          k="Minor Addendum"
          v={record.includesMinorAddendum ? 'Included (§ 744.301(3) notice shown)' : 'Not included'}
        />
        <AuditRow k="Document SHA-256" v={record.documentSha256} mono />
        <AuditRow
          k="Signature"
          v={record.signatureMethod === 'drawn' ? 'Drawn on screen' : 'Typed name, rendered as a signature'}
        />
        <AuditRow k="Signature SHA-256" v={record.signatureSha256} mono />
        <AuditRow k="Record SHA-256" v={record.recordSha256} mono />

        <Text style={[s.heading, { marginTop: 12 }]}>
          Initials, in the order given (times from the signer&apos;s device)
        </Text>
        {record.initials.map((i) => (
          <AuditRow key={i.section} k={i.section} v={`${i.initials} · ${marinaTime(i.at)} · ${i.at}`} />
        ))}
      </Page>
    </Document>
  );
}

export async function renderSignedWaiverPdf(input: WaiverPdfInput): Promise<Buffer> {
  return renderToBuffer(<SignedWaiverDocument {...input} />);
}

function Blank({ label, wide }: { label: string; wide?: boolean }) {
  return (
    <View style={wide ? s.cellWide : s.cell}>
      <Text style={s.label}>{label}</Text>
      <View style={s.blankLine} />
    </View>
  );
}

/**
 * The same agreement on paper, for a guest who won't sign electronically
 * (the e-sign consent promises one) or a phone that won't cooperate at
 * the dock. Always includes the minor addendum; a signer with no children
 * leaves it blank.
 */
function PaperWaiverDocument({ doc }: { doc: WaiverDocument }) {
  const running = (
    <View style={s.runningHead} fixed>
      <Text>
        {RELEASED_PARTY} · Liability waiver · version {doc.version} (based on {WAIVER_BASED_ON})
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Paper copy · page ${pageNumber} of ${totalPages}`} />
    </View>
  );
  return (
    <Document title={`Liability waiver — paper copy — version ${doc.version}`} author={RELEASED_PARTY}>
      <Page size="LETTER" style={s.page}>
        {running}
        <Text style={s.title}>{doc.title.toUpperCase()}</Text>
        <Text style={s.subtitle}>{RELEASED_PARTY}</Text>
        <View style={s.box}>
          <View style={s.grid}>
            <Blank label="Charter date and time" />
            <Blank label="Booking name" />
            <Blank label="Participant / signer (full legal name)" />
            <Blank label="Date of birth" />
            <Blank label="Email" />
            <Blank label="Phone" />
            <Blank label="Home address" wide />
          </View>
        </View>
        {doc.sections.map((section) => (
          <Section key={section.id} section={section} initials="blank" />
        ))}
        {doc.minorAddendum && (
          <View break>
            <Text style={s.addendumTitle}>{MINOR_ADDENDUM_TITLE.toUpperCase()}</Text>
            <Text style={{ color: soft, marginBottom: 4 }}>
              Only for a parent or court-appointed legal guardian signing for a participant under 18.
              Section 744.301(3), Florida Statutes.
            </Text>
            {doc.minorAddendum.map((section) => (
              <Section key={section.id} section={section} initials="blank" />
            ))}
            <Text style={s.heading}>Minor children covered by this Addendum</Text>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={s.grid}>
                <Blank label="Child’s full name" />
                <Blank label="Date of birth · Parent or legal guardian?" />
              </View>
            ))}
            <Blank label="Adult supervising the minor(s) on the charter, if not the signer" wide />
          </View>
        )}
        <View wrap={false} style={{ marginTop: 12 }}>
          <Text style={[s.para, { fontWeight: 'bold' }]}>{doc.attestation}</Text>
          <View style={[s.grid, { marginTop: 16 }]}>
            <Blank label="Signature" />
            <Blank label="Date" />
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderPaperWaiverPdf(doc: WaiverDocument): Promise<Buffer> {
  return renderToBuffer(<PaperWaiverDocument doc={doc} />);
}
