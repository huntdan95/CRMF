import 'server-only';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BOAT_CAPACITY } from '@/lib/availability';
import { siteConfig } from '@/lib/site-config';
import { slotLabels, tours } from '@/lib/tours';
import { registerReadTools } from './read-tools';
import { registerWriteTools } from './write-tools';

const departures = [
  ...new Map(
    tours
      .filter((t) => t.timeSlot !== 'sunset')
      .map((t) => [t.timeSlot, `${slotLabels[t.timeSlot]} ${t.startTimeDisplay}–${t.endTimeDisplay}`]),
  ).values(),
].join('; ');

const INSTRUCTIONS = `Booking system for ${siteConfig.name}: ${siteConfig.captain.fullName}'s guided pontoon-boat manatee tours on the Crystal River, Florida.

- One boat, up to ${BOAT_CAPACITY} guests. Departures: ${departures}. The whole-day charter needs the day otherwise empty.
- Each departure goes out as a shared tour (seats sold per person) or a private one (the whole boat, flat price), never both.
- The sunset cruise (private only, no swim) runs April 1 – November 14. It leaves 90 minutes before sunset, rounded down to the quarter hour, and is out 2 hours, so its time changes daily; tools show it per date. From late September it overlaps the late-afternoon tour: whichever is booked first takes the boat.
- Dates are YYYY-MM-DD in marina time (America/New_York).
- Changes made here go through the same checks, customer emails and audit log as the admin site.
- Refunds and cancellations can't be done here. Give Travis the booking's adminUrl instead.`;

/** A fresh server per request: the endpoint is stateless. */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'crystal-river-manatee-fun', title: siteConfig.name, version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  );
  registerReadTools(server);
  registerWriteTools(server);
  return server;
}
