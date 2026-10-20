import 'server-only';
import { adminDb } from './firebase/admin';
import type { BlackoutRow, ClosedDays, ClosureRow } from './departure-off';

/*
 * Whether a departure Travis closed is going out, for the crew app and the
 * admin dashboard: the rules are in src/lib/departure-off.ts, which admin
 * pages reading Firestore in the browser use too. This reads the rows they
 * go by.
 */

export {
  blackoutCovers,
  calledOffDepartures,
  departureOff,
  type BlackoutRow,
  type ClosedDays,
  type ClosureRow,
  type DepartureOff,
} from './departure-off';

/** Blackouts and closure actions from `from` to `to` (or on), marina dates. */
export async function fetchClosedDays(from: string, to?: string): Promise<ClosedDays> {
  const db = adminDb();
  let blackoutQ = db.collection('blackouts').where('date', '>=', from);
  let actionQ = db.collection('closureActions').where('date', '>=', from);
  if (to) {
    blackoutQ = blackoutQ.where('date', '<=', to);
    actionQ = actionQ.where('date', '<=', to);
  }
  const [blackouts, actions] = await Promise.all([blackoutQ.get(), actionQ.get()]);
  return {
    blackouts: blackouts.docs.map((d) => ({ ...(d.data() as Omit<BlackoutRow, 'id'>), id: d.id })),
    actions: new Map(actions.docs.map((d) => [d.id, { ...(d.data() as Omit<ClosureRow, 'id'>), id: d.id }])),
  };
}
