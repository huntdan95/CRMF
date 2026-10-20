import 'server-only';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BOAT_CAPACITY } from '@/lib/availability';
import { siteConfig } from '@/lib/site-config';
import { slotLabels, tours } from '@/lib/tours';
import { registerBlogTools } from './blog-tools';
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
- The sunset cruise (private only, no swim) runs April 1 – November 14. It leaves 90 minutes before sunset, rounded down to the quarter hour, and is out 2 hours, so its time changes daily; tools show it per date. From late September it overlaps the late-afternoon tour: whichever is booked first takes the boat. A sunset booking imported from the old website can be dated outside the season; it still holds the boat at that day's sunset time, so on a winter evening it keeps the late-afternoon tour off sale.
- Dates are YYYY-MM-DD in marina time (America/New_York).
- Changes made here go through the same checks, customer emails and audit log as the admin site.
- Refunds and cancellations can't be done here. Give Travis the booking's adminUrl instead.
- The blog: get_blog_brief says whether a post is due (every other week) and how to write one; check_blog_post until it passes, then submit_blog_post. Travis approves each post by email before it goes on the site.`;

const BLOG_INSTRUCTIONS = `The blog for ${siteConfig.name} (${siteConfig.url}): ${siteConfig.captain.fullName}'s guided manatee snorkel tours on the Crystal River, Florida.

- One post every other week. Start with get_blog_brief: if it says a post isn't due, stop.
- Photos come from Travis's Google Drive: list_blog_photos, then view_blog_photo before choosing.
- check_blog_post until it passes (no RED checks), then submit_blog_post with exactly that draft. Travis gets it by email and approves it before it goes on the site; nothing more to do after submitting.`;

/** A fresh server per request: the endpoint is stateless. */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'crystal-river-manatee-fun', title: siteConfig.name, version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  );
  registerReadTools(server);
  registerWriteTools(server);
  registerBlogTools(server);
  return server;
}

/** Only the blog tools: what /api/mcp/blog (grokbot) gets. */
export function createBlogMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'crystal-river-manatee-fun-blog', title: `${siteConfig.name} blog`, version: '1.0.0' },
    { instructions: BLOG_INSTRUCTIONS },
  );
  registerBlogTools(server);
  return server;
}
