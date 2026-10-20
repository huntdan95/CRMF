import 'server-only';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer';
import React from 'react';
import type { Booking } from './firebase/types';
import { BOAT_CAPACITY } from './availability';
import { slotLabels } from './tours';
import { SANS, unprintableChars } from './waiver/fonts';

interface RenderOpts {
  booking: Booking;
  tour: { startTimeDisplay: string; endTimeDisplay: string } | null;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 11,
    color: '#1A1F1B',
    // The signed waiver's fonts (./waiver/fonts), for guests' names in any
    // script they cover. The built-in Helvetica prints wrong letters for
    // anything past Western European ("Łukasz", "Иван", "王伟").
    fontFamily: SANS,
  },
  header: {
    borderBottom: '1pt solid #1B6FA8',
    paddingBottom: 12,
    marginBottom: 14,
  },
  brand: { fontSize: 9, color: '#7A8B7E', textTransform: 'uppercase', letterSpacing: 1.5 },
  title: { fontSize: 22, fontWeight: 'bold', marginTop: 4 },
  meta: { fontSize: 10, color: '#4A524C', marginTop: 4 },
  grid: { flexDirection: 'row', gap: 18, marginBottom: 16 },
  col: { flex: 1 },
  sectionTitle: {
    fontSize: 9,
    color: '#7A8B7E',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  field: { marginBottom: 6 },
  fieldLabel: { fontSize: 8, color: '#7A8B7E' },
  fieldValue: { fontSize: 11 },
  partyHeader: {
    flexDirection: 'row',
    borderBottom: '1pt solid #1A1F1B',
    paddingBottom: 4,
    marginBottom: 4,
    fontWeight: 'bold',
    fontSize: 10,
  },
  partyRow: {
    flexDirection: 'row',
    borderBottom: '1pt solid #ddd',
    paddingVertical: 6,
    minHeight: 36,
  },
  cellNum: { width: 24, fontSize: 11 },
  cellName: { flex: 2, fontSize: 11 },
  cellAge: { flex: 1, fontSize: 11 },
  cellSig: { flex: 2, fontSize: 11, borderBottom: '1pt dashed #999' },
  notesBox: {
    marginTop: 16,
    borderRadius: 6,
    padding: 10,
    backgroundColor: '#F5EDD8',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    borderTop: '1pt solid #ddd',
    paddingTop: 8,
    fontSize: 8,
    color: '#7A8B7E',
    textAlign: 'center',
  },
});

function ManifestDocument({ booking, tour }: RenderOpts) {
  const slot = slotLabels[booking.timeSlot as keyof typeof slotLabels] ?? booking.timeSlot;
  const dateStr = formatDate(booking.date);
  // Old-site imports have no guest names, and some no party size: still a
  // line per guest (a boatful when the size is unknown) for them to sign.
  const partyKnown = booking.guestCount > 0 || booking.guests.length > 0;
  const rows = partyKnown ? Math.max(booking.guestCount, booking.guests.length) : BOAT_CAPACITY;

  return (
    <Document title={`Manifest ${booking.id}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={styles.brand}>Crystal River Manatee Fun — Boarding Manifest</Text>
          <Text style={styles.title}>{booking.tourName}</Text>
          <Text style={styles.meta}>
            {dateStr} · {slot}
            {tour ? ` · ${tour.startTimeDisplay} – ${tour.endTimeDisplay}` : ''}
          </Text>
        </View>

        <View style={styles.grid}>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Lead guest</Text>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Name</Text>
              <Text style={styles.fieldValue}>{booking.customerName}</Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <Text style={styles.fieldValue}>{booking.customerEmail}</Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Phone</Text>
              <Text style={styles.fieldValue}>{booking.customerPhone}</Text>
            </View>
          </View>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Emergency contact</Text>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Name</Text>
              <Text style={styles.fieldValue}>{booking.emergencyContactName}</Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Phone</Text>
              <Text style={styles.fieldValue}>{booking.emergencyContactPhone}</Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Booking</Text>
              <Text style={styles.fieldValue}>
                #{booking.id} · {booking.guestCount} guest{booking.guestCount === 1 ? '' : 's'} ·{' '}
                {booking.type === 'private' ? 'Private' : 'Shared'}
              </Text>
            </View>
          </View>
        </View>

        <View>
          <Text style={styles.sectionTitle}>
            Party ({partyKnown ? booking.guestCount : 'size not recorded'}) — sign on arrival
          </Text>
          <View style={styles.partyHeader}>
            <Text style={styles.cellNum}>#</Text>
            <Text style={styles.cellName}>Name</Text>
            <Text style={styles.cellAge}>Age</Text>
            <Text style={styles.cellSig}>Signature</Text>
          </View>
          {Array.from({ length: rows }, (_, i) => {
            const g = booking.guests[i];
            return (
              <View key={i} style={styles.partyRow}>
                <Text style={styles.cellNum}>{i + 1}</Text>
                <Text style={styles.cellName}>{g?.name ?? ' '}</Text>
                <Text style={styles.cellAge}>{g ? (g.age != null ? String(g.age) : '—') : ' '}</Text>
                <Text style={styles.cellSig}> </Text>
              </View>
            );
          })}
        </View>

        {booking.adminNotes && (
          <View style={styles.notesBox}>
            <Text style={[styles.sectionTitle, { marginBottom: 2 }]}>Internal notes</Text>
            <Text>{booking.adminNotes}</Text>
          </View>
        )}

        <Text style={styles.footer} fixed>
          Manatee viewing follows USFWS guidelines. Passive observation, no
          touching, no chasing. Capt. Travis Urbin · 352-586-7792
        </Text>
      </Page>
    </Document>
  );
}

export async function renderManifestPdf(opts: RenderOpts): Promise<Buffer> {
  const b = opts.booking;
  const booking: Booking = {
    ...b,
    tourName: await printable(b.tourName),
    customerName: await printable(b.customerName),
    customerEmail: await printable(b.customerEmail),
    customerPhone: await printable(b.customerPhone),
    emergencyContactName: await printable(b.emergencyContactName),
    emergencyContactPhone: await printable(b.emergencyContactPhone),
    guests: await Promise.all(b.guests.map(async (g) => ({ ...g, name: await printable(g.name) }))),
    adminNotes: b.adminNotes && (await printable(b.adminNotes)),
  };
  return renderToBuffer(<ManifestDocument {...opts} booking={booking} />);
}

/**
 * `text` with each character the fonts can't draw (Korean, Arabic, Thai,
 * emoji, …) shown as □, the way a phone shows one: left in, it prints as
 * other letters. The manifest is Travis's boarding sheet, not a signed
 * record, so it's left at that; the booking in admin has the name as typed.
 */
async function printable(text: string): Promise<string> {
  // Old-site bookings can lack a phone or an emergency contact.
  if (!text) return text;
  // A tab prints as nothing, running the words either side together.
  const spaced = text.replace(/\t/g, ' ');
  const missing = new Set(await unprintableChars(spaced));
  // Line breaks have no glyph either, but they lay the text out rather
  // than print: notes keep their lines.
  missing.delete('\n');
  missing.delete('\r');
  return missing.size === 0 ? spaced : Array.from(spaced, (ch) => (missing.has(ch) ? '□' : ch)).join('');
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((n) => Number.parseInt(n, 10));
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
