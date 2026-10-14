import 'server-only';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isValidIsoDate } from '@/lib/date';
import type { TourTimeSlot } from '@/lib/firebase/types';
import { formatPrice, slotLabels, tours } from '@/lib/tours';
import { AdminFunctionError } from './admin-functions';

export const isoDate = z.string().refine(isValidIsoDate, 'Use a real date written YYYY-MM-DD');

export const TIME_SLOTS = [
  'morning',
  'mid-morning',
  'early-afternoon',
  'late-afternoon',
  'whole-day',
] as const satisfies readonly TourTimeSlot[];

/** A tool's answer, as pretty JSON the model can read. */
export function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Runs a tool body, turning a failure into an error result the model can
 * read instead of a protocol error. Admin-function refusals ("Only 3 spots
 * left…") pass through word for word.
 */
export async function attempt(tool: string, run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof AdminFunctionError) return fail(err.message);
    console.error(`MCP tool ${tool} failed`, err);
    return fail('Couldn’t reach the booking database. Try again in a minute.');
  }
}

export function money(cents: number | null | undefined): string | null {
  return typeof cents === 'number' ? formatPrice(cents) : null;
}

/** US dollars as typed by a person ("55", "55.5") to the cents the functions take. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Firestore Timestamp (or anything else) to an ISO string, or null. */
export function isoTime(value: unknown): string | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return (value.toDate() as Date).toISOString();
  }
  return null;
}

/** `YYYY-MM-DD` plus `n` days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** "8:00 AM – 10:00 AM" for a slot, from the built-in schedule. */
export function slotTimes(slot: string): string | null {
  const tour = tours.find((t) => t.timeSlot === slot);
  return tour ? `${tour.startTimeDisplay} – ${tour.endTimeDisplay}` : null;
}

export function slotLabel(slot: string): string {
  return slotLabels[slot as TourTimeSlot] ?? slot;
}

/** Sorts departures by date, then the order they leave the dock. */
export function byDeparture(a: { date: string; timeSlot: string }, b: { date: string; timeSlot: string }): number {
  return a.date.localeCompare(b.date) || slotStart(a.timeSlot).localeCompare(slotStart(b.timeSlot));
}

function slotStart(slot: string): string {
  return tours.find((t) => t.timeSlot === slot)?.startTime ?? '99:99';
}
