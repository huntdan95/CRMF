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
import { slotLabels } from './tours';

interface RenderOpts {
  booking: Booking;
  tour: { startTimeDisplay: string; endTimeDisplay: string } | null;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 11,
    color: '#1A1F1B',
    fontFamily: 'Helvetica',
  },
  header: {
    borderBottom: '1pt solid #1B6FA8',
    paddingBottom: 12,
    marginBottom: 14,
  },
  brand: { fontSize: 9, color: '#7A8B7E', textTransform: 'uppercase', letterSpacing: 1.5 },
  title: { fontSize: 22, fontFamily: 'Helvetica-Bold', marginTop: 4 },
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
    fontFamily: 'Helvetica-Bold',
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
          <Text style={styles.sectionTitle}>Party ({booking.guestCount}) — sign on arrival</Text>
          <View style={styles.partyHeader}>
            <Text style={styles.cellNum}>#</Text>
            <Text style={styles.cellName}>Name</Text>
            <Text style={styles.cellAge}>Age</Text>
            <Text style={styles.cellSig}>Signature</Text>
          </View>
          {booking.guests.map((g, i) => (
            <View key={i} style={styles.partyRow}>
              <Text style={styles.cellNum}>{i + 1}</Text>
              <Text style={styles.cellName}>{g.name}</Text>
              <Text style={styles.cellAge}>{g.age != null ? String(g.age) : '—'}</Text>
              <Text style={styles.cellSig}> </Text>
            </View>
          ))}
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
  return renderToBuffer(<ManifestDocument {...opts} />);
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
