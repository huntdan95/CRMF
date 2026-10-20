# Crystal River Manatee Fun

Marketing site + custom booking system for Capt. Travis Urbin's guided pontoon-boat manatee tours on the Crystal River.

Replacing the existing WordPress build at [crystalrivermanateefun.com](https://crystalrivermanateefun.com).

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript + React 19 |
| Styling | Tailwind CSS v4 |
| Database | Cloud Firestore |
| Auth | Firebase Authentication (Google, admin-only) |
| File storage | Cloud Storage for Firebase |
| Server logic | Cloud Functions for Firebase |
| Payments | Stripe (via the Stripe Node SDK in Cloud Functions; Firebase Extension optional) |
| Email | Resend |
| Hosting | Firebase App Hosting (auto-deploy from GitHub `main`) |
| Source control | GitHub — [huntdan95/CRMF](https://github.com/huntdan95/CRMF) |

> Note: the original plan specified Next.js 15, but `create-next-app` is now pinning Next 16. App Router + RSC + React 19 are unchanged, so we're proceeding on 16.

## Repo layout

```
.
├── apphosting.yaml            # App Hosting env vars (referenced as secrets)
├── firebase.json              # Rules / functions / emulator config
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── next.config.ts             # WordPress URL redirects + security headers
├── content/news/              # News posts migrated from WordPress (Markdown); grokbot's are in Firestore
├── docs/grokbot-blog.md       # Grokbot's every-other-week blog: setup and the automation prompt
├── functions/                 # Cloud Functions workspace
│   └── src/                   # 12 endpoints (public + admin)
├── scripts/seed.ts            # Firestore tour seeder
├── scripts/check-redirects.ts # Verifies old WordPress URLs (npm run check:redirects)
├── scripts/connect-google-drive.ts # One-time Drive hookup for trip photos (npm run connect:drive)
├── public/crew-sw.js          # Crew app service worker (push notifications)
├── test/                      # Unit tests for the app (npm test)
├── .github/workflows/ci.yml   # PR + main checks
└── src/
    ├── app/
    │   ├── (marketing)/       # Home, tours, captain, etc.
    │   ├── (booking)/         # /book/*, /my-booking/[id]
    │   ├── admin/             # /admin/login + /admin/(protected)/*
    │   ├── crew/              # Crew app: /crew/login, /crew (schedule + trip photos)
    │   ├── api/admin/session  # Login session cookie endpoint
    │   ├── api/crew/          # Crew sign-in, push subscriptions, photo uploads
    │   ├── api/mcp/           # MCP server endpoint (see "MCP server")
    │   ├── error.tsx, not-found.tsx, sitemap.ts, robots.ts, manifest.ts
    │   └── layout.tsx
    ├── components/
    │   ├── marketing/         # Header, Footer, TourCard, …
    │   ├── booking/           # Calendar, SlotPicker, DetailsForm, …
    │   └── admin/             # AdminShell, calendar, booking actions, …
    └── lib/
        ├── firebase/          # client.ts, admin.ts, auth-server.ts, auth-client.ts
        ├── mcp/               # MCP tools: read-tools.ts, write-tools.ts, blog-tools.ts
        ├── seo-check.ts       # Yoast-style SEO + readability check for blog posts
        ├── blog-publish.ts, blog-photos.ts, news.ts  # Grokbot's blog (see docs/grokbot-blog.md)
        ├── tours.ts           # Static catalog (kept in sync with seed)
        ├── site-config.ts     # Phone, marina, social
        ├── functions-client.ts, admin-client.ts, admin-firestore.ts
        ├── date.ts, refund-policy.ts, clsx.ts
        └── manifest-pdf.tsx   # Boarding manifest PDF renderer
```

## Local development

### 1. Prerequisites

- Node 22+ (the Cloud Functions runtime is pinned to Node 22 and CI builds `functions/` on 22; the Next.js app itself still builds on Node 20 in CI)
- A Firebase project on the Blaze (pay-as-you-go) plan — Cloud Functions requires it
- A Stripe account (test-mode is fine for local dev)
- A Resend account with a verified sending domain

### 2. Install

```bash
npm install
npm install --prefix functions
```

### 3. Environment variables

```bash
cp .env.local.example .env.local
```

Fill in:

- **Firebase web config** — Firebase console → Project settings → Your apps → Web app
- **Firebase Admin service account** — Project settings → Service accounts → Generate new private key (paste into `FIREBASE_ADMIN_*`)
- **Admin allowlist email** — the Google account that logs in at `/admin` (`travisurbin1@gmail.com`). More accounts can be let in with `OTHER_ADMIN_EMAILS`; see [One-time setup](#one-time-setup)
- **Stripe** — secret + publishable keys (test mode for dev); the webhook signing secret comes after deploy
- **Resend** — API key and your verified `From:` address
- **`NEXT_PUBLIC_FUNCTIONS_BASE_URL`** — for local dev pointing at the emulator: `http://127.0.0.1:5001/<project>/us-central1`

### 4. Run

```bash
npm run dev                          # Next dev server on http://localhost:3000
npm --prefix functions run build     # Compile Cloud Functions to functions/lib
npm --prefix functions test          # Booking-rule, checkout-hold, cancel and webhook tests (no emulator needed)
```

### 4a. Seed the tour catalog

`scripts/seed.ts` writes the nine tour records from [src/lib/tours.ts](src/lib/tours.ts) into the Firestore `tours` collection. Safe to re-run: missing tours are created, and existing ones only get their schedule fields (slot, start time, duration, type, capacity) updated. Name, description, prices, what's included and Active belong to Travis in **Admin → Tours** and are left alone unless you pass `--reset`.

```bash
npm run seed:dry        # preview — no auth needed
npm run seed            # writes to the project in .env.local
npm run seed:emulator   # writes to the local emulator (FIRESTORE_EMULATOR_HOST=localhost:8080)
npm run seed -- --reset # also overwrite Travis's edits with src/lib/tours.ts
```

**Where tour data lives.** The schedule (slots, times, durations) is code in `src/lib/tours.ts`. Everything Travis edits is in Firestore: the `tours` docs, plus `rateSeasons` (date ranges with their own per-tour prices). The site reads both through `fetchTourCatalog()` ([src/lib/tours-server.ts](src/lib/tours-server.ts)) and refreshes every 60 seconds, or straight away when Travis saves a change ([Refreshing the site](#refreshing-the-site)); checkout (`createCheckoutSession`) reads the same docs, and both resolve seasonal prices with the same rules ([src/lib/pricing.ts](src/lib/pricing.ts), copied in `functions/src/lib/pricing.ts`). Where seasons overlap, the shortest range that prices a tour wins.

### 4b. Import bookings from the old WordPress site

`scripts/import-legacy-bookings.ts` loads the bookings CSV exported from the old admin (`CRMF_bookings_2023-2026.csv`) into the `bookings` collection as `legacy-<old booking #>` docs. Keep the CSV outside the repo; it holds customer contact details (`*.csv` is gitignored).

```bash
npm run import:legacy -- --file ~/Downloads/CRMF_bookings_2023-2026.csv --dry-run   # counts only, no auth
npm run import:legacy -- --file ~/Downloads/CRMF_bookings_2023-2026.csv             # create missing docs
npm run import:legacy -- --file <newer export> --update-existing                    # re-sync at launch
```

What it does:

- Old "confirmed" becomes `completed` (past) or `confirmed` (upcoming). "Reserved" becomes `pending-payment`. "Rescheduled" and "cancelled" become `cancelled` with a reason.
- Old "pending payment" is a WooCommerce order nobody finished paying. With nothing paid it becomes `cancelled` ("Not paid on the old site"); with a deposit or part payment it's treated like "reserved". The dry run lists the upcoming ones, with their old order status, so they can be checked against the old site before the launch re-sync.
- Tours map to the new slot by start time. Whole-day and sunset tours map by name; sunset tours go on the private sunset cruise, so they hold the boat at sundown. That includes ones dated outside the cruise's season (Nov 15 – Mar 31): the cruise isn't sold online then, but a booking on it still has the boat at that day's sunset time, so on a winter evening (it leaves about 4:00 PM in December) it keeps the 3:30 off sale. Sunset, eco and older 3-hour tours keep their old names.
- Upcoming confirmed and pending bookings hold their seats, so the new calendar won't double-book them. The dry run lists them, shows each sunset tour's old start time beside the new sunset departure (marked when it's out of season), and flags any the new calendar wouldn't have allowed together (a private tour sharing its departure, too many shared seats, the whole-day charter with anything else that day, the sunset cruise and the 3:30 on the same evening, late in the season or in winter).
- Every imported booking is marked as already followed up, so the daily follow-up email job never emails old customers.
- The old order numbers, Stripe transaction IDs and original tour name are kept under `legacy` on each doc.

Limits to know about:

- Imported bookings have no Stripe payment intent, so **cancelling one in the new admin refunds nothing.** Nothing is recorded as refunded: the amount paid goes into the booking's private notes as a reminder to refund it by hand, in Stripe directly, and is kept on the booking as `manualRefundCents`. Reports (its own CSV column) and the dashboard count that as given back, not kept, and the customer's booking page says Travis will refund it. Once he has, **Refunded by hand** on the booking's Cancellation card records the date (`manualRefundedAt`; admin site only, not MCP): the admin stops listing it as owed and the booking page says it's been refunded. The amount stays in `manualRefundCents`, so Reports don't change. The customer isn't emailed unless Travis ticks the box, and then the email says he'll be in touch about the money. A reason Travis types with the box unticked stays his: it's saved with `cancellationReasonPrivate` and left off the customer's booking page.
- `--update-existing` overwrites status, date, tour, customer and payment fields from the CSV. Changes made to those fields on the new site are lost; admin notes, access tokens and follow-up markers are kept. Money a new-site cancel left to refund by hand is cut to what the CSV says is still unrefunded (to nothing once the old site shows it refunded), so it isn't counted as given back twice. A booking the CSV puts back after the new admin cancelled it, or moves to another departure, loses any closure, so it isn't offered a new date and cancelled again.

### 5. (Optional) Firebase emulators

```bash
npm install -g firebase-tools
firebase emulators:start            # UI at http://localhost:4000
```

Ports are in `firebase.json`. Set `NEXT_PUBLIC_FUNCTIONS_BASE_URL=http://127.0.0.1:5001/<project>/us-central1` and `FIRESTORE_EMULATOR_HOST=localhost:8080` in `.env.local` to point the app at the emulator.

## Cloud Functions

HTTPS endpoints, plus Firestore triggers and scheduled jobs. Public ones use origin-allow-list CORS; admin ones require a Firebase ID-token Bearer header. The two webhooks (`stripeWebhook`, `resendWebhook`) are checked by signature instead.

### Public / customer-facing

| Function | Verb | Purpose |
|---|---|---|
| `getAvailability` | GET | Live slot capacity + month blackouts for the calendar UI |
| `createCheckoutSession` | POST | Creates the Stripe Checkout session → Firestore txn checks seats and creates the `pending-payment` booking with its session id (so Stripe's expiry always frees the hold) → returns the Checkout URL. Refuses impossible dates, departures less than 60 min away (Eastern time), and dates over 365 days out. Card only (`payment_method_types: ['card']`; Apple Pay and Google Pay come with it), so a bank debit that takes days to clear, and can fail after the trip, can't be picked even if it's turned on in the Stripe dashboard. One visitor can have 3 unpaid checkouts open: a 4th started within 35 minutes of them gets a 429 (`reason: 'too-many-checkouts'`), and the booking page tells them to finish one, wait for them to lapse, or call Travis. The checkout being replaced (`previousBooking`, with its token) doesn't count. A visitor is their IP address (an IPv6 address's /64): the last `X-Forwarded-For` entry that isn't one of Google's own proxy addresses (those come after the visitor's and can't be forged), never one the client wrote or Express's `req.ip`. Only a SHA-256 of it is kept, as `checkoutIpHash` on the booking; with no usable address nobody is refused. The count is read in the booking transaction, so two checkouts at once can't both get the last place. When it turns someone away, `ADMIN_EMAIL` gets `[CRMF] Checkout turned away: Sam Rivera (Sat Oct 17, 8:00 shared)` with their contact details and the open checkouts, at most once a day per visitor (Resend idempotency key `checkout-limit/<hash>/<marina date>`). See [functions/src/lib/checkout-limit.ts](functions/src/lib/checkout-limit.ts) |
| `releaseCheckoutHold` | POST | Token-authenticated. Expires an abandoned Stripe Checkout session, then cancels its `pending-payment` booking so the seats free up immediately |
| `stripeWebhook` | POST | Signature-verified, idempotent; confirms `pending-payment` bookings and triggers the Resend email. A payment on a booking that's already cancelled is refunded in full and emailed to `ADMIN_EMAIL`, never confirmed. A booking paid less than 60 min before its departure (the online cutoff, marina time, sunset cruise included) or after it left also emails `ADMIN_EMAIL` right away, `[CRMF] Last-minute booking: Sat Oct 17, 8:00 — paid 7:29 AM`, with a tap-to-call link and the admin link; it goes after the customer's confirmation, once per booking, and a failure is only logged |
| `resendWebhook` | POST | Signature-verified (Svix), idempotent on `svix-id`. Follows each email the site sends: delivered, bounced, delayed, marked as spam. See [Email log and bounce alerts](#email-log-and-bounce-alerts) |
| `fetchBooking` | POST | Token-authenticated read for `/book/confirmation/[id]` and `/my-booking/[id]`. Leaves out admin-only fields, and a cancel reason Travis kept private |
| `cancelBooking` | POST | Customer-initiated cancel with Stripe refund per policy. The cancel dialog sends the refund it showed (`expectedRefundCents`); if the policy now gives less (the dialog sat open past the 72-hour line), nothing is cancelled and a 409 with code `refund-changed` returns the new amount to confirm. An unpaid booking's Checkout session is expired first (like `releaseCheckoutHold`), with no cancellation email. On a departure Travis closed with "pick a new date", always a full refund; that dialog sends the full amount as `expectedRefundCents` too, so if the closure came off before they confirmed it gets the policy's figure back instead of a cancellation for less. On a trip Travis reopened after that offer, a full refund until the offer's deadline (`refundGraceUntil`, see [Closing a day](#closing-a-day)), which the dialog shows too. Old-site bookings are refused; the page tells those customers to call Travis. While Travis is closing the departure (undo window open, or going out) it's a 409 with code `closure-pending`, checked again as the cancel is written, unless their full refund has already gone to Stripe. If Travis cancelled it first, the answer is `alreadyCancelled` and no email goes out |
| `requestReschedule` | POST | Customer reschedule request — emails Travis, logs to `rescheduleRequests` |
| `moveClosedBooking` | POST | Token-authenticated. Moves a booking Travis closed to another open departure of the same kind, no charge (not into a higher-priced date), and emails the updated confirmation |

### Admin (Bearer token, audit-logged)

| Function | Purpose |
|---|---|
| `adminCancelBooking` | Full refund regardless of policy. If the booking is cancelled another way just as Stripe takes the refund, the refund stands: it's recorded on the booking with a note, audited as `booking.refund`, and returned with `alreadyCancelled` |
| `adminPartialRefund` | Arbitrary partial refund, booking stays active |
| `adminRecordManualRefund` | "Refunded by hand": records (`manualRefundedAt`) that Travis has paid back the old-site money a cancellation left owing (`manualRefundCents`). No money moves. Admin site only, not `MCP_TOKEN` |
| `adminResetBookingLinks` | "Reset their booking links", for when an email went to the wrong person: gives the booking a new `accessToken` in a transaction, so everything made from the old one stops working: the `/my-booking` and `/book/confirmation` links (`fetchBooking`, `cancelBooking`, `requestReschedule`, `moveClosedBooking`), the `.ics` download and the self-service link inside one already saved, and every waiver signing link (`?k=` is a hash of the token), forwarded ones included. Signed waivers, and each signer's link to their own copy, are untouched. Then emails the new links to the booking's current address: the confirmation for a confirmed trip still to come, or the "pick a new date" offer while they're choosing after a closure; nothing for a cancelled or finished booking, an old-site reservation, one past its choose-by date or with no address, and the answer (`email`) says which, or why not. Refused while the customer is still paying online (Stripe returns them with the old token). Audit-logged without the token. Admin site only, not `MCP_TOKEN` |
| `adminEditBooking` | Edit guest count, names, ages, contact info; capacity-checked (an old-site booking with no party size already holds the whole boat, so recording its size never needs seats). The customer's email address only from the admin site, not with `MCP_TOKEN`. Refuses a booking whose online payment hasn't gone through: the checkout charges what it was opened for |
| `adminRescheduleBooking` | Move to a different date / tour that hasn't left yet, with the same seat rules as online booking (the booking's own seats aside); optional email, and the answer says whether it went (`emailed`, and `reason` if not). Only a confirmed booking is emailed, not an old-site reservation. A move settles a closure offer (`closure`) and ends a reopened trip's full-refund grace (`refundGraceUntil`). Refuses if the booking was cancelled or moved meanwhile, a booking whose online payment hasn't gone through, and one with no party size onto a shared tour |
| `adminMarkBooking` | Flip to `no-show` once the departure has left, or `completed` once it's back (marina time; marked while it's still out, the boat would go back on sale): a confirmed booking or an old-site reservation, not one on a departure Travis closed while the customer is still choosing |
| `adminAddNote` | Internal note. Replaces the notes, refused if they've changed since `previousNotes` (the admin note window), or adds a line with `append` (MCP) |
| `adminResendConfirmation` | Re-fire the booking-confirmation email. Confirmed bookings only, not once the trip date has passed or for a departure Travis closed |
| `adminFixBouncedEmail` | Save the customer's corrected email address and send each bounced email again where there's a way to (admin site only) |
| `adminCreateBlackout` | Add a blackout that only stops new bookings. Used by MCP's `create_blackout`; the admin site closes days through the next three |
| `adminPreviewClosure` | What closing these departures would do, per booking and per choice (offer a new date, cancel and refund, leave booked), with the exact customer emails rendered from the real templates. Sends nothing. Returns a confirm token per choice. See [Closing a day](#closing-a-day) |
| `adminConfirmClosure` | Takes a confirm token (and `CANCEL` when anyone is booked). Refuses if anything changed since the preview; otherwise blocks the departures at once and starts the undo window. Nothing is sent, cancelled or refunded until it ends |
| `adminUndoClosure` | Within the undo window: removes the blackout. Nothing was sent. Anyone an earlier closure of the same trips left waiting on a new date (it was reopened while this one covered them) goes back on their trip: returned as `restored`, with `crewTold` as for a reopen |
| `adminSendClosureNow` | Skips the rest of the undo window |
| `adminDeleteBlackout` | Reopen a day. During the undo window it's the same as Undo; after it, cancelled bookings stay cancelled and anyone still picking a new date goes back on their trip. See [Closing a day](#closing-a-day) |
| `adminUpdateTour` | Edit tour name, description, standard price, active, included. The price is per person on a shared tour and for the boat on a private one; setting the other is refused, since checkout never reads it |
| `adminUpsertRateSeason` | Create / edit a seasonal or holiday rate: name, date range, prices by tour |
| `adminDeleteRateSeason` | Delete a rate season (those dates go back to standard prices) |
| `adminUpdateSettings` | Cancellation policy text, contact email, and `closureUndoMinutes` (0–60, default 10) |
| `adminAddCrewMember` | Add a swim guide / mate: name, email, password (stored as an scrypt hash) |
| `adminSetCrewPassword` | Replace a crew password; signs them out on every phone and stops their calendar link |
| `adminRemoveCrewMember` | Remove crew: deletes their sign-ins, notification subscriptions and calendar link |
| `adminSetTripCrew` | Take the crew off one trip so Travis runs it solo (`soloTrips/{date_slot}`), or put them back on |
| `adminSendCrewCalendarLink` | Email a crew member a new calendar subscription link; their old link stops working. See [Crew calendar](#crew-calendar) |

Every admin write goes to `auditLog/{entryId}` with the admin email, action, target id, and before/after payload.

The [MCP server](#mcp-server) can also call the edit, reschedule, mark, note, resend, blackout, tour, rate-season, inbox and trip-crew functions, using the `MCP_TOKEN` secret instead of Travis's sign-in. Those entries carry `via: 'mcp'` and show as "by automation" in Admin → Activity. The refund, cancel, settings, site-image, testimonial and crew-account functions don't accept the token.

### Refreshing the site

The public pages are cached and refresh every 60 seconds. To show a change at once, the functions that change what the pages show call the site's **`POST /api/revalidate`** at `APP_BASE_URL` once the change is saved: `adminUpdateTour`, `adminUpsertRateSeason`, `adminDeleteRateSeason`, the site-image and testimonial functions, and `adminUpdateSettings` when the cancellation policy text changes ([functions/src/lib/site-refresh.ts](functions/src/lib/site-refresh.ts)). The route ([src/app/api/revalidate/route.ts](src/app/api/revalidate/route.ts)) takes a key worked out from `MCP_TOKEN` (an HMAC, like the [blog key](#blog-grokbot), compared in constant time), so there's no other secret to keep, and the key opens nothing else. It refreshes every page under the root layout: both public layouts put the tour catalog on every page they render, and the share image and sitemap read it too. Pages render again on their next visit.

If the site can't be reached, the function logs it and the change still saves; the 60-second refresh catches up. The refresh clears the cache of the App Hosting instance that answers, so with a second instance running (or a cached copy in front of it) a page can lag up to a minute. Admin → Tours and Admin → Photos say "now, or within a minute at most".

### Firestore triggers

| Function | Fires on | Purpose |
|---|---|---|
| `notifyCrewOfBooking` | `bookings/{id}` written | Push notification to the crew's phones when a booking becomes `confirmed`. Inside the online cutoff it starts with how soon the trip leaves ("Leaves in 25 min") |
| `notifyCrewOfSoloTrip` | `soloTrips/{id}` created or deleted | Push notification to the crew's phones when Travis takes them off a trip, or puts them back on |
| `sendCrewTestPush` | `crewPushTests/{id}` created | The crew app's "Send a test" button |
| `onContactMessageCreated` | `contactMessages/{id}` created | Emails Travis the contact-form message |
| `onBlogReviewRequested` | `blogReviewRequests/{id}` created | Emails Travis grokbot's draft blog post, with the link to approve it. A request whose email fails is kept, with the error |

### Scheduled jobs

Marina time (America/New_York).

| Function | When | Purpose |
|---|---|---|
| `sendTourRemindersDaily` | 9:00 AM and 5:00 PM | Day-before reminder to everyone going out tomorrow: departure and arrive-by time, marina and directions, what to bring, the Open-Meteo forecast, the manage link. Skips bookings made in the last 12 hours (the confirmation covers them) and departures Travis has closed or is closing (a blackout covers them; reopened before 5 PM, they get it then). The 5 PM run retries failures. **Off until launch:** `SEND_TOUR_REMINDERS` in `functions/.env.crmf-99aad` |
| `sendWaiverReminders` | 3:00 PM | To the booker of each trip going out tomorrow whose party hasn't all signed waivers: who's still to sign (with no party size on file, just how many have signed and a nudge to check everyone has), and the signing link. Once per departure, so a booking moved to another day gets one for that day too. Skips departures Travis has closed or is closing, like the tour reminder, and bookings with no email address (some old-site ones; the button says so). Marker: `waiverReminderSentFor`. **Send waiver reminder** on the booking page sends one any time. **Off until launch**, with the tour reminder: `SEND_TOUR_REMINDERS` |
| `sendPostTourFollowups` | 7:00 AM | The day-after "how was it" email with the Instagram and Google review asks |
| `settleClosedBookings` | 6:00 AM | When Travis closes a departure with "pick a new date", the customer has until 3 days after the closed date to move or take the refund. This cancels and fully refunds the ones who did neither (old-site money gets a note for Travis to refund by hand), and emails them that the deadline passed. One Travis moves, or puts back on its trip, as it runs is left alone |
| `finalizeClosures` | Every minute | Runs closed days whose undo window is up (see [Closing a day](#closing-a-day)), retries a booking that was paid for mid-cancel, and picks up a finalize that died |
| `sendClosureRemindersHourly` | Every hour | One reminder to each customer who hasn't picked a new date or a refund, in the 24 hours before `settleClosedBookings` refunds them. Marker: `closure.reminderSentAt` |

### Closing a day

Admin → **Close a day**, or **Weather cancel** on the dashboard (today, or the Today / Tomorrow lists), which opens it on that date with Weather picked. Built so Travis can't close the wrong day or the wrong trips by accident:

1. **Pick.** Each departure that day with its time, tour type, bookings and guests; empty ones are dashed. Departures that have left (marina time) can't be picked, and "All trips that day" turns off once one has. A past date can't be closed. More than 3 days out asks "Forecasts change. Cancel this far ahead?" first.
2. **Review.** `adminPreviewClosure` returns "You're cancelling 3 trips on Saturday, Oct 17: 14 guests in 5 bookings", every booking with what happens to it under each choice (refund amount, offer and deadline, left alone, old-site money flagged for a manual refund), and the email each customer would get. Nothing is sent.
3. **Confirm.** Travis types `CANCEL` to enable the red button. The confirm token is 32 random bytes; Firestore keeps only its SHA-256 (`closurePreviews/{hash}`, server-only) with the date, slots, reason, choice, the admin, a 30-minute expiry and a fingerprint of every affected booking (id, status, date, slot, tour, guests, amounts, payment intent, email, closure, `updatedAt`). `adminConfirmClosure` re-checks admin rights, recomputes the fingerprint inside the same transaction that writes the blackout, and refuses with "Something changed since you looked" if it differs. The page then reloads the review.
4. **Undo window.** The blackout goes up at once, so nobody can book those trips. `closureActions/{blackoutId}` (admin-read, functions-write) records who, when, the choice and `finalizeAt`. No booking is changed and nothing is sent until then. A banner on the dashboard and on Close a day counts down with **Undo** and **Send now**. Reopening the day meanwhile is the same as Undo. With nobody booked, or 0 minutes in Settings, it goes through straight away.
5. **Finalize.** Send now or `finalizeClosures` claims the action in a transaction (`pending` → `finalizing`), so they can't both run it. It re-reads the day's bookings, so a checkout paid during the window is included, and runs the chosen option (`runClosureCascade` in `functions/src/lib/close-day.ts`). A booking moved to another trip while it runs is left alone: each is checked again as it's marked or cancelled. Each customer email carries a Resend idempotency key, and the offer is stamped `closure.offerEmailedAt`, so a re-run doesn't email anyone twice. A booking paid for as it was being cancelled is tried again two minutes later, up to three times. A finalize that dies is picked up again after 15 minutes; each booking it cancelled is stamped with its id (`cancelledByClosure`) and what it refunded (`closureRefundCents`), so the rerun counts those, with their own refunds, and not ones Travis or an expired checkout cancelled meanwhile.
6. **Crew.** Once per closure (`crewAlert` on the action, claimed in a transaction): a push to the crew app and an email to each `crew/{id}.email`, subject `[CRMF] Weather cancel: Sat Oct 17, 8:00 and 10:30 (14 guests)` (`14+ guests`, or `party size unknown`, with old-site bookings that have no party size on file). Failures are logged and don't hold up the cancel.

The crew schedule and the dashboard show a closed departure as **Cancelled**, **Being called off** (undo window open) or **Closed, still booked** (Travis left the guests booked to call them).

**Reopening** a day (Reopen on Close a day, or MCP's `delete_blackout`) after it has gone out leaves cancelled bookings cancelled. Anyone it offered a new date who hasn't moved or taken the refund goes back on their original trip, as if it had never closed: `closure` comes off the booking, with a note, so `settleClosedBookings` doesn't refund them, the crew and the dashboard count them, and they get the day-before reminders if the day is reopened before those go out (by 3 PM the day before for the waiver reminder, 5 PM for the tour reminder). The offer's full refund still stands, since they were promised it in writing: the booking keeps the offer's deadline as `refundGraceUntil`, and until the end of that day (marina time) `cancelBooking` refunds a customer cancel in full instead of under the 72-hour policy. Their booking page and cancel dialog say so ("Travis reopened your trip; you can still cancel for a full refund until it leaves", or until the date, if that comes first), working it out the same way, so the dialog's `expectedRefundCents` matches. Put back by an undo, it's the deadline of the earlier offer they were sent; put back twice, the later deadline. Travis moving the booking (`adminRescheduleBooking`) takes it off. They aren't emailed; `adminDeleteBlackout` returns them (`restored`) for Travis to tell. Not a trip that has already left, nor one another closed day still covers: those customers still choose (if that other one is still in its undo window and is undone, the undo puts them back, in the same transaction). Each booking changes in its own transaction, and only while it's still waiting (`restoreOfferedBookings` in `functions/src/lib/close-day.ts`), and is recorded on the closure as it goes (`restoredBookingIds`), so a reopen that fails partway and is tried again still lists everyone it put back. If the crew were told those trips were off, they're told they're back on, once (`reopenCrewAlert` on the action): a push that replaces the closure's on their phones and an email, subject `[CRMF] Back on: Sat Oct 17, 8:00 (4 guests)`. That includes a day Travis left booked (the crew heard it was closed: the message covers the bookings still on those trips) and an undo that puts back someone an earlier closure's alert named. A failure there is logged and doesn't stop the reopen; the reopen notice says whether the message reached all the crew (`crewTold`).

### Email log and bounce alerts

Every email goes through `sendEmail` in `functions/src/lib/email-log.ts`, which logs it to `emailLog/{resendEmailId}` (kind, booking, recipients, subject, status) and tags it in Resend with its kind and booking id. `resendWebhook` updates that entry as Resend reports on it. The status only moves forward (sent → delayed → delivered → bounced → complained), so an event arriving late doesn't undo a bounce. Resend takes only a few requests a second, so an email it turns away for its rate limit (`rate_limit_exceeded`, as when the crew are emailed one after another) is tried twice more, a second and then two seconds later, with the same idempotency key.

When an email to a customer goes wrong, Travis (`ADMIN_EMAIL`, nobody else) gets one email per booking per kind of email, e.g. `[CRMF] Email bounced: call Jane Smith (Sat Oct 17, 10:30 shared)`, with the bad address, a tap-to-call link and the admin link:

| Resend event | What happens |
|---|---|
| `email.bounced`, `bounce.type` = Permanent | Flagged on the booking ("Email bounced" in admin); Travis alerted right away |
| `email.bounced`, any other type (Transient, Undetermined) | Flagged; Travis alerted only if the trip leaves within 48 hours |
| `email.delivery_delayed` | Travis alerted only if the trip leaves within 24 hours |
| `email.complained` | `marketingSuppressed` on the booking, so the daily "thanks for coming" email skips it. No alert |
| `email.delivered` | Recorded on the log entry |

Emails to Travis himself never alert, so an alert that bounces can't set off another. In admin, **Fix email and resend** on the booking saves the right address and sends again whatever bounced (confirmation, updated confirmation, "pick a new date" offer or its reminder, tomorrow's reminder, waiver reminder, "thanks for coming"). A confirmation doesn't go again once the trip date has passed, or for a departure he closed: the "pick a new date" offer takes its place. A waiver reminder goes again with who's still to sign as of then, unless everyone has signed since or the trip has happened. Weather-cancel emails to the crew are logged too, as `crew`, and never alert; so is each signer's copy of their signed waiver (`waiverCopy`), which goes to the address they typed when signing, not the booking's. A cancellation or "we got your request" note isn't sent again; the page says to call them.

Changing the address in **Edit booking** instead clears every alert marker on the booking (delay alerts included), so trouble with the new address alerts Travis again, but sends nothing. The "Email bounced" flag stays up: use **Fix email and resend** to send again what bounced.

An email that didn't bounce but reached the wrong person still carries working links to the booking. Fix the address in **Edit booking**, then **Reset their booking links** (under the customer's details): the old links stop working, waiver links they forwarded included, and the new ones go to the right address (`adminResetBookingLinks`).

## Crew app

Travis's swim guides and mates have their own login at **`/crew`**, separate from admin. Crew can see confirmed upcoming tours (time, tour, headcount; no customer names or contact details), with any Travis called off still listed and marked cancelled, get a phone notification whenever a tour is booked or called off, and upload the GoPro photos from each trip. They can't change anything else.

- **Adding crew:** Admin → **Crew**. Travis enters a name and email; the page makes up a random password (`k7m4-xq9p-2wht` style). After saving he gets a message with the link, email and password to text them. Passwords are stored as scrypt hashes, so they can't be shown again, only reset. A reset or removal signs that person out on every phone.
- **Installing:** on iPhone, open `/crew` in Safari → Share → **Add to Home Screen**, then open *Manatee Crew* from the home screen and sign in there. iOS only allows web notifications from a home-screen app (iOS 16.4+), and it keeps that app's sign-in separate from Safari's. On Android, Chrome works as-is; adding to the home screen is optional.
- **Notifications:** after signing in, tap **Turn on notifications**, then **Send a test**. Sign-in sessions last a year; 10 wrong passwords lock an account for 15 minutes.
- **Running a trip solo:** when a trip is too small to pay crew for, Travis switches its **Crew** off under Admin → Crew → **Upcoming trips** (or on today's and tomorrow's cards on the dashboard). The crew app keeps the trip on the schedule, faded, with "No crew needed", the crew calendar feed's event says the same (with no reminder, and it doesn't block their time), and every crew phone gets a notification. Switching it back on sends another. The switch is per departure (date and time), so it stays off if more guests book that trip; their booking notification says "No crew needed".

### Crew calendar

Admin → **Crew** → **Send calendar link** emails that crew member a link that puts every booked departure in their phone's calendar. iPhone: tap the `webcal://` button in the email, then Subscribe. Google Calendar: Other calendars → + → From URL, paste the `https://` link. Crew can also get or replace their own link from the crew app (**Trips in your calendar**).

- **Feed:** `/api/crew-calendar/<token>` (`src/app/api/crew-calendar/[token]/route.ts`, built by `src/lib/crew-calendar/`). The last 14 days and the next 120, one event per departure with guests: `8:00 shared · 6 guests`, `3:30 private · 4 guests`, `7:00 whole-day charter · 5 guests`. A departure Travis closed that had bookings stays in the calendar as `CANCELLED (weather): 8:00 shared` with `STATUS:CANCELLED`. Marina time with an `America/New_York` VTIMEZONE, Pete's Pier as the location, a 60-minute reminder, and a link to the crew app (sign-in needed).
- **Privacy:** counts only. No guest names, phones or emails, because Apple and Google copy subscribed calendars to their servers. The route only reads the booking fields it counts.
- **Links:** a random 32-byte token. Firestore keeps only its SHA-256 (`crewCalendarTokens/{hash}`, and the live hash on `crewCalendars/{crewId}`), all server-only. Sending a new link, resetting the password or removing the crew member kills the old one; a dead link gets a plain 404. The token is in the URL, so it also shows up in App Hosting's request logs: keep access to those logs to Travis and Danny. The feed is sent `Cache-Control: private, no-cache`, so no shared cache keeps a copy.
- **Updates:** each event has a stable UID (`<date>_<slot>@crystalrivermanateefun.com`), and its SEQUENCE goes up whenever its content changes (`crewCalendarDepartures/{date_slot}` keeps a fingerprint per departure). The feed asks for a refresh every 15 minutes, but that's a hint: iPhone checks fairly often, Google Calendar can lag by hours. Push notifications and `[CRMF]` emails stay the source for last-minute changes; the email says so.

### Trip photos → Google Drive → grokbot

Under **Trip photos**, crew see each trip from the last 7 days. They tap **Add photos**, pick the shots, and the files upload straight from the phone to Google Drive. They don't go through our server. A trip is one departure: every booking on the same boat at the same time. The Drive account connected below gets:

```
Manatee Fun Trip Photos/
  2026-10-17 08:00 Morning shared/
    guests.csv            trip_date, departure, tour, booking_id, customer_name,
                          customer_email, party_size, party_names (one row per booking;
                          no-shows and cancellations left out)
    _READY_TO_SEND.txt    appears when a crew member taps "Photos are all in"
    GOPR0123.JPG …
```

**Grokbot contract:** only email a trip's photos once its folder contains `_READY_TO_SEND.txt`, send to every `customer_email` in that folder's `guests.csv`, and send once per folder. Several crew can upload to the same trip before anyone marks it ready.

The blog picks photos from these folders too ([Blog (grokbot)](#blog-grokbot)).

The site uses the `drive.file` scope, so it can only see the folders and files it created, never the rest of that Drive. Bookkeeping lives in Firestore (`tripPhotos/{date_slot}`, `driveConfig/tripPhotos`). If the trip folder is deleted in Drive, the next upload starts a fresh one.

### Crew app setup

1. **Push notifications.** The VAPID key pair is already generated. The public key is in `apphosting.yaml` and `functions/src/lib/crew-push.ts`; the private key was written to `vapid-private-key.local.txt` (gitignored). Store it, then delete the file:

   ```bash
   firebase functions:secrets:set VAPID_PRIVATE_KEY --data-file vapid-private-key.local.txt
   ```

2. **Google Drive for trip photos.** In the [Google Cloud console](https://console.cloud.google.com) for the Firebase project:
   1. **APIs & Services → Library:** enable the **Google Drive API**.
   2. **OAuth consent screen:** User type *External*, add the `.../auth/drive.file` scope, then **Publish app** (status *In production*). A *Testing* app's tokens expire after 7 days. `drive.file` isn't a sensitive scope, so Google doesn't need to review the app.
   3. **Credentials → Create credentials → OAuth client ID**, type **Desktop app**.
   4. Run the connect script and sign in as the Google account whose Drive grokbot reads:

      ```bash
      npm run connect:drive -- <client-id> <client-secret>
      ```

   5. Set the two App Hosting secrets it prints (`GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`) and grant the `default` backend access to them (`firebase apphosting:secrets:grantaccess <name> --backend default`). Then put the client ID in `GOOGLE_DRIVE_CLIENT_ID` in `apphosting.yaml`. The secrets have to exist first, because App Hosting refuses to deploy with a missing secret. Until this is done, the crew app shows "Photo uploads aren't connected yet".
   6. After the first upload creates **Manatee Fun Trip Photos** in that Drive, share the folder with whoever else needs it (Travis, grokbot's account). Don't make the folder by hand: with `drive.file` the site can't see folders it didn't create.

   It's connected for `crmf-99aad`. If crew see "Google Drive needs reconnecting", run step 4 again and re-set `GOOGLE_DRIVE_REFRESH_TOKEN`.

3. **Deploy** rules and functions (`firebase deploy --only firestore:rules,functions`), then push to `main`.

## MCP server

The site is also an [MCP](https://modelcontextprotocol.io) server at **`/api/mcp`**, so Claude (or any MCP client) can check the calendar and handle routine admin work. It runs inside the Next.js app on App Hosting. It reads Firestore directly and makes changes through the same admin Cloud Functions as the admin pages, so it gets the same validation, capacity checks, customer emails and audit log. It speaks Streamable HTTP, stateless, with JSON responses (`POST` only).

| Read-only | Changes |
|---|---|
| `get_availability`: open seats per departure, up to 62 days | `add_booking_note`: appends to the internal notes |
| `list_tours`: schedule, standard prices, seasonal rates, price on a date | `mark_booking`: completed / no-show |
| `list_bookings`: by date range, customer email or search text | `resend_confirmation_email` |
| `get_booking`: guests, contacts, payments, notes, reschedule requests, admin link | `edit_booking`: party size, guest list, contact details except the email address |
| `get_day_schedule`: each departure's seats, manifest, and whether it has crew | `reschedule_booking`: capacity-checked, emails a confirmed customer by default and says whether it did |
| `list_blackouts` | `create_blackout` / `delete_blackout`: never cancels bookings; lists the ones still on a closed departure |
| `list_contact_messages` | `update_tour`: name, description, included, active, price (dollars) |
| `list_reschedule_requests` | `upsert_rate_season` / `delete_rate_season` |
| | `update_contact_message` / `update_reschedule_request` |
| | `set_trip_crew`: take the crew off a trip, or put them back on; notifies the crew |

It also has the blog tools (`get_blog_brief`, `list_blog_photos`, `view_blog_photo`, `check_blog_post`, `submit_blog_post`). Grokbot reaches those, and only those, at **`/api/mcp/blog`** with a key worked out from `MCP_TOKEN`; see [Blog (grokbot)](#blog-grokbot).

**What it can't do:** refunds, cancellations, blackouts that cancel bookings, changing a customer's email address (their booking links go to it) or resetting those links, site settings, photos, reviews or crew accounts. Answers about a booking include its admin link for those. Customer access tokens are never returned.

### Setup

It's switched on for `crmf-99aad`. These are the steps it took, for a new project or a rebuild:

1. Make a token (at least 32 characters) and store it as one Secret Manager secret, used by both Cloud Functions and App Hosting:

   ```bash
   openssl rand -hex 32 > mcp-token.local.txt
   firebase functions:secrets:set MCP_TOKEN --data-file mcp-token.local.txt
   firebase apphosting:secrets:grantaccess MCP_TOKEN --backend <backend-id>
   ```

   Keep the token in your password manager, then delete the file.

2. Deploy functions (`firebase deploy --only functions`), then push to `main`. If the change tools fail with "refused the MCP token", the functions haven't been redeployed since the secret was set.

`apphosting.yaml` and the admin functions both read `MCP_TOKEN`, so the secret has to exist (with App Hosting access granted) before any rollout or functions deploy. App Hosting refuses to roll out without it, and the Firebase CLI asks for a value.

### Connecting

Use `https://crystalrivermanateefun.com/api/mcp` once the domain has moved, and `https://default--crmf-99aad.us-east4.hosted.app/api/mcp` before that.

- **Claude (claude.ai, desktop and mobile):** Settings → Connectors → **Add custom connector**. Paste the URL with the token on the end, `https://crystalrivermanateefun.com/api/mcp?key=<token>`, and leave the OAuth fields empty. Treat that whole URL like a password.
- **Claude Code:**

  ```bash
  claude mcp add --transport http manatee-fun https://crystalrivermanateefun.com/api/mcp \
    --header "Authorization: Bearer <token>"
  ```

- **Anything else:** send `Authorization: Bearer <token>`. The `?key=` form works too.

The token can do everything in the table above, so keep it private. To replace it, set a new value with the same `functions:secrets:set` command, run `firebase deploy --only functions`, start a new App Hosting rollout, and update each connector.

## Blog (grokbot)

Every other week Post Bot (a Grok automation, separate from the SEO bot) writes a post for `/news` with photos from Travis's Google Drive, through the blog tools at `/api/mcp/blog`. A draft has to pass a Yoast-style SEO and readability check (`src/lib/seo-check.ts`): keyphrase placement and density, title and meta description length, internal and outbound links (each one checked), images and alt text, text length, subheadings, sentence and paragraph length, Flesch reading ease, passive voice and transition words, plus a few of our own. Then Travis gets the whole post by email, and it goes on the site only when he approves it on the review page (`/blog-review/<slug>`, from the email, or **Admin → Blog**). If he turns it down, his note goes back to Post Bot. A weekly automation posts every other week (`src/lib/blog-rules.ts`).

Posts live in `newsPosts/{slug}` and their photos in Storage under `public/news/<slug>/`. The News pages merge them with the Markdown posts in `content/news`. **Setup, the automation prompt and the full list of checks: [docs/grokbot-blog.md](docs/grokbot-blog.md).**

## Deploying

### One-time setup

1. **Create the Firebase project** in the console (suggested: `crystal-river-manatee-fun`).
2. **Upgrade to the Blaze plan** — Cloud Functions and App Hosting both require it. Costs at this volume are single-digit dollars per month.
3. **Enable services:** Authentication (Google provider), Firestore (production mode), Cloud Storage, Cloud Functions, App Hosting.
4. **Authorize the admin Google account.** In Authentication, ensure `travisurbin1@gmail.com` has signed in (you can do this from the local dev app once you've populated `.env.local`). The Firestore rules and `NEXT_PUBLIC_ADMIN_EMAIL` are already wired to this address. To let another Google account into admin (it won't get Travis's booking emails), add it in four places, then roll out the site and run `firebase deploy --only functions,firestore:rules,storage`: `OTHER_ADMIN_EMAILS` in `apphosting.yaml` and in `functions/.env.crmf-99aad` (comma-separated), and the list in `isAdmin()` in `firestore.rules` and in `storage.rules`.
5. **Connect Firebase App Hosting to the GitHub repo** — pick this repo, branch `main`, set the rollout policy. Future pushes to `main` auto-deploy.
6. **Let Google sign-in return to the site.** Admin sign-in runs Firebase's helper pages on the site's own address (`/__/auth/*`, proxied to `crmf-99aad.firebaseapp.com` by `next.config.ts`), because browsers that block cross-site storage (Safari, iPhone home-screen apps, newer Chrome) fail with "missing initial state" when they're on `firebaseapp.com`. In [Google Cloud console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials?project=crmf-99aad), open the OAuth client **Web client (auto created by Google Service)** and add one entry under **Authorized redirect URIs** for every address admins sign in on:
   - `https://default--crmf-99aad.us-east4.hosted.app/__/auth/handler`
   - `https://crystalrivermanateefun.com/__/auth/handler`
   - `https://www.crystalrivermanateefun.com/__/auth/handler`

   Do this before the code that relies on it rolls out. Until then, Google shows `Error 400: redirect_uri_mismatch` at sign-in. Local `next dev` (plain http) still signs in through `firebaseapp.com` in a pop-up window and needs no entry.

### Set secrets

`apphosting.yaml` declares the env vars the app needs at build + runtime. The public ones (the Firebase web config, `NEXT_PUBLIC_ADMIN_EMAIL`, `NEXT_PUBLIC_FUNCTIONS_BASE_URL`, the VAPID public key) are plain `value:`s in the file, since they ship to the browser anyway: change them there. Only the entries with `secret:` are App Hosting secrets: `GOOGLE_DRIVE_CLIENT_SECRET` and `GOOGLE_DRIVE_REFRESH_TOKEN` (see [Crew app setup](#crew-app-setup)), and `MCP_TOKEN`, which is the Cloud Functions secret of the same name and only needs access granted (see [MCP server](#mcp-server)). Create each and give the backend access:

```bash
firebase apphosting:secrets:set GOOGLE_DRIVE_CLIENT_SECRET
firebase apphosting:secrets:grantaccess GOOGLE_DRIVE_CLIENT_SECRET --backend <backend-id>
# …repeat for every `secret:` entry in apphosting.yaml
```

Cloud Function secrets are separate (set with `firebase functions:secrets:set NAME`):

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- `RESEND_WEBHOOK_SECRET` (bounce alerts — see [Wire up Resend](#wire-up-resend))
- `APP_BASE_URL` (e.g. `https://crystalrivermanateefun.com`; also where the admin functions [refresh the site](#refreshing-the-site))
- `VAPID_PRIVATE_KEY` (crew push notifications — see [Crew app setup](#crew-app-setup))
- `MCP_TOKEN` (the MCP endpoint, also read by App Hosting — see [MCP server](#mcp-server))

### Deploy infra

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```

After functions are live, look up the deployed `stripeWebhook` URL:

```bash
firebase functions:list   # or check the Firebase console
```

It looks like `https://us-central1-<project>.cloudfunctions.net/stripeWebhook`.

### Wire up Stripe

1. In the [Stripe dashboard](https://dashboard.stripe.com/webhooks), add a webhook endpoint pointing at the deployed `stripeWebhook` URL.
2. Subscribe to events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `payment_intent.payment_failed`
   - `charge.refunded`
3. Copy the signing secret Stripe shows you and run `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET`. Redeploy functions.

### Wire up Resend

1. In [Resend](https://resend.com), verify your sending domain (likely `mail.crystalrivermanateefun.com` or `crystalrivermanateefun.com`).
2. Create an API key and `firebase functions:secrets:set RESEND_API_KEY`.
3. Set the `From:` address (`firebase functions:secrets:set RESEND_FROM_EMAIL`). It must use a verified domain.
4. **Bounce alerts.** `resendWebhook` needs `RESEND_WEBHOOK_SECRET` to deploy, so create the secret first, then add the endpoint, then set the real value:
   1. `firebase functions:secrets:set RESEND_WEBHOOK_SECRET` with any placeholder value, and deploy functions. Until the real secret is in, the webhook refuses everything (nothing is processed).
   2. In the [Resend dashboard → Webhooks](https://resend.com/webhooks), add an endpoint pointing at the deployed `resendWebhook` URL (`https://us-central1-<project>.cloudfunctions.net/resendWebhook`).
   3. Select these four events: `email.delivered`, `email.bounced`, `email.delivery_delayed`, `email.complained`.
   4. Copy the endpoint's signing secret (it starts `whsec_`) and run `firebase functions:secrets:set RESEND_WEBHOOK_SECRET` with it. Redeploy functions (`firebase deploy --only functions`) so they pick up the new version.
   5. Deploy the Firestore rules too (`firebase deploy --only firestore:rules`): `emailLog` and `resendWebhookEvents` are server-only.

### Set the public functions URL

Once functions are deployed, check that `NEXT_PUBLIC_FUNCTIONS_BASE_URL` in `apphosting.yaml` is their base URL, `https://us-central1-<project>.cloudfunctions.net`. It's a plain value, not a secret, and it's built into the client, so a change takes effect on the next rollout.

This is what the client uses to call public Cloud Functions (`createCheckoutSession`, `getAvailability`, etc.).

### Seed the tour catalog

```bash
npm run seed
```

### Push and verify

```bash
git push origin main      # App Hosting picks it up automatically
```

Watch the App Hosting rollout in the console. Once it's `LIVE`, visit the URL and walk through a real booking with a Stripe test card.

The site deploys on every push to `main`, but Cloud Functions and Firestore rules only when someone runs `firebase deploy`. When a change touches both (a function that takes a new field, a page that expects a new response), deploy functions and rules right after the merge, so the two aren't out of step for long:

```bash
firebase deploy --only functions,firestore:rules
```

### Custom domain

In App Hosting → your backend → Domains, add `crystalrivermanateefun.com`. Update DNS at the registrar with the records Firebase provides. SSL provisions automatically (usually within 30 minutes).

#### Staging stays out of Google

Every response served from a host other than `crystalrivermanateefun.com` (the `*.hosted.app` URL, `localhost`) carries `X-Robots-Tag: noindex, nofollow`, and its `/robots.txt` is `Disallow: /`. That's done in `src/proxy.ts` and `src/app/robots.ts`, so nothing needs switching on.

#### `CANONICAL_HOST_REDIRECT`

Declared in `apphosting.yaml`, default `"false"`. When set to `"true"`, `src/proxy.ts` sends a 301 from `www.crystalrivermanateefun.com` and the `*.hosted.app` URL to the same path and query on `https://crystalrivermanateefun.com`. It leaves these alone:

- `/api/*` and `/admin/*`: the admin session cookie belongs to the host it was set on
- `/__/*`: Firebase's sign-in helper pages, which have to stay on the host the sign-in started on
- anything that isn't a GET or HEAD, so a form post isn't turned into a GET

Turn it on only once SSL is active on the apex domain. Changing the value takes effect on the next rollout.

## CI

`.github/workflows/ci.yml` runs three jobs on every push to `main` and on every PR:

1. **App** — `npm ci` + `npm run lint` (soft) + `npm test` + `npm run build` (strict TS check)
2. **Functions** — `npm ci` + `npm run build` + `npm test` in `functions/`
3. **Seed dry-run** — `npm run seed:dry` (catches catalog drift without needing Firebase creds)

## Launch checklist

### Owner content and accounts

- [ ] Real photography in `public/images/` (hero, gallery, tour featured shots, captain headshot) and a 1200×630 `images/og.jpg` for social cards
- [ ] Real guest testimonial (homepage currently has a placeholder)
- [ ] Owner-confirmed copy for the "Where to stay / eat / do" lists in the Crystal River section of `/about` (`/about#area`)
- [ ] Public contact email (currently `TODO_OWNER_EMAIL` in `src/lib/site-config.ts`; the site hides it until it's set)
- [ ] Google Business Profile URL (`siteConfig.googleBusinessProfile`) and the exact marina pin (`siteConfig.marina`), both marked `TODO(owner)` in `src/lib/site-config.ts`
- [ ] Stripe account approved for live mode + live keys in App Hosting secrets
- [ ] Resend domain verification + `From:` address
- [ ] Resend webhook for bounce alerts + `RESEND_WEBHOOK_SECRET` (see [Wire up Resend](#wire-up-resend))
- [ ] Travis signed in at `/admin/login` at least once so Auth has his profile
- [ ] Composite indexes deployed (in the `firebase deploy` command above)
- [ ] First `npm run seed` against the live project
- [ ] Old-site bookings imported with `npm run import:legacy`, then re-synced from a fresh export with `--update-existing` on launch day
- [x] Old-URL redirects checked against the WordPress sitemaps. The list is in `src/lib/legacy-redirects.ts`, and `npm run check:redirects` verifies it.

### Moving the domain without losing rankings

The full plan is in [SEO_MIGRATION.md](SEO_MIGRATION.md). These are owner and DNS tasks.

**Before launch**

- [ ] Get access to the domain registrar, the Google Business Profile (as Primary Owner) and Search Console from the previous developer.
- [ ] Verify a **Domain property** in Search Console with a DNS TXT record, so it keeps working after the hosting move. Export 16 months of Performance data (Queries and Pages) as a baseline.
- [ ] **ASK, analytics:** the new site sends analytics to Firebase measurement ID `G-5GZX07YZTV`. The old site's GA4 (connected through Site Kit) is probably a different property. Link the old property for continuous reporting, or start fresh? Rankings aren't affected either way: Google doesn't use Analytics data for ranking, and ranking history lives in Search Console. If starting fresh, keep access to the old property (don't delete it) so its history stays readable.
- [ ] Record every current DNS record, especially **MX and email TXT records** (SPF, DKIM), and lower the TTL 48 hours ahead.
- [ ] Add `crystalrivermanateefun.com` and `www.crystalrivermanateefun.com` under Firebase Authentication → Settings → Authorized domains, and their `/__/auth/handler` redirect URIs to the Google OAuth client (step 6 of [One-time setup](#one-time-setup)), so admin Google sign-in works on the new domain.
- [ ] Run `npm run check:redirects -- --base https://default--crmf-99aad.us-east4.hosted.app`. It must pass cleanly.
- [ ] Run Lighthouse on the marketing pages (target 90+ on Performance / Accessibility / Best Practices / SEO).
- [ ] Pick a launch date outside manatee season (mid-November to March) if possible. A brief ranking dip costs the most in December.

**Launch**

- [ ] Add the apex and `www` domains in App Hosting and update the A and TXT records. **Don't touch the MX records.**
- [ ] Set the Functions secret `APP_BASE_URL=https://crystalrivermanateefun.com` and the Stripe live keys.
- [ ] After the first few real checkouts, open two bookings made from different places in the Firestore console and check their `checkoutIpHash` values differ. If every booking has the same one, the address `clientIp` (`functions/src/lib/checkout-limit.ts`) reads is a proxy's, not the visitor's, and the three-checkout limit is shared by everyone: fix `clientIp` before it turns customers away.
- [ ] Once the old site's bookings are re-synced, set `SEND_TOUR_REMINDERS=true` in `functions/.env.crmf-99aad` and deploy functions. Until then both day-before emails, the tour reminder and the waiver reminder, stay off, so nobody who booked or cancelled on the old site gets one. (Travis's **Send waiver reminder** button still works.)
- [ ] As soon as the domain serves the new site, confirm Google can index it: `curl -sI https://crystalrivermanateefun.com` shows **no** `X-Robots-Tag` header, and `/robots.txt` shows `Allow: /` and the sitemap. Every other host is noindexed on purpose (see [Staging stays out of Google](#staging-stays-out-of-google)), so if either check fails, App Hosting isn't passing the real hostname through. Fix that before going further.
- [ ] Set `CANONICAL_HOST_REDIRECT` to `"true"` in `apphosting.yaml` once SSL is active on the domain, and roll out (see [`CANONICAL_HOST_REDIRECT`](#canonical_host_redirect)). Then make one real booking end to end, and refund it, to confirm checkout still works.
- [ ] Run `npm run check:redirects -- --base https://crystalrivermanateefun.com`.

**After launch**

- [ ] Submit `/sitemap.xml` in Search Console. Use URL Inspection to request indexing for the home page, `/tours`, `/faq` and the tour pages.
- [ ] Run the homepage, a tour page, `/faq` and a news post through Google's [Rich Results Test](https://search.google.com/test/rich-results) and note the results.
- [ ] Update the Google Business Profile booking link to `/book`.
- [ ] Update listings that link to old WordPress tour URLs (`/product/...`) so they point at the new pages: Facebook, the Instagram bio, Tripadvisor, discovercrystalriverfl.com. The redirects cover them, but a direct link is better.
- [ ] Watch Search Console's Pages and 404 reports weekly for 8 weeks, and add redirects to `src/lib/legacy-redirects.ts` for any old URL that shows up.
- [ ] Keep the WordPress backup for at least 90 days. Don't cancel the old hosting until DNS has fully propagated and email is confirmed working.

## Phase status

- [x] **Phase 1** — Project bootstrap
- [x] **Phase 2** — Marketing pages + design system
- [x] **Phase 3** — Tour data + Firestore seed
- [x] **Phase 4** — Customer booking flow + Stripe Checkout
- [x] **Phase 5** — Customer self-service (token-authenticated)
- [x] **Phase 6** — Admin panel
- [x] **Phase 7** — Polish + deploy
