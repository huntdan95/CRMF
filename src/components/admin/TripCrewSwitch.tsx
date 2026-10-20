'use client';

import { useState } from 'react';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import { shortDate } from './booking-labels';
import { Badge, Switch } from './ui';

/**
 * Crew on or off one trip. Off means Travis runs it alone because it's too
 * small to pay crew for. The crew app shows the trip as "No crew needed" and
 * the crew's phones are told either way, so it asks first.
 */
export function TripCrewSwitch({
  date,
  timeSlot,
  time,
  noCrew: initialNoCrew,
}: {
  date: string;
  timeSlot: string;
  /** "8:00 AM", for the confirm message. */
  time: string;
  noCrew: boolean;
}) {
  const [noCrew, setNoCrew] = useState(initialNoCrew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(crewNeeded: boolean) {
    const when = `${shortDate(date)} at ${time}`;
    const ok = confirm(
      crewNeeded
        ? `Put the crew back on ${when}?\n\nThey’ll get a notification that it needs crew again.`
        : `Run ${when} yourself, without crew?\n\nThey’ll get a notification that they aren’t needed.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await admin.setTripCrew(date, timeSlot, crewNeeded);
      setNoCrew(!crewNeeded);
    } catch (err) {
      setError(err instanceof FunctionError ? err.message : 'That didn’t save. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3">
        <Switch checked={!noCrew} onChange={change} disabled={busy}>
          Crew
        </Switch>
        {noCrew && <Badge tone="sand">You’re running it solo</Badge>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-[var(--color-coral-dark)]">
          {error}
        </p>
      )}
    </div>
  );
}
