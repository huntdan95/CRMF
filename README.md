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

**Where tour data lives.** The schedule (slots, times, durations) is code in `src/lib/tours.ts`. Everything Travis edits is in Firestore: the `tours` docs, plus `rateSeasons` (date ranges with their own per-tour prices). The site reads both through `fetchTourCatalog()` ([src/lib/tours-server.ts](src/lib/tours-server.ts)) and refreshes every 60 seconds; checkout (`createCheckoutSession`) reads the same docs, and both resolve seasonal prices with the same rules ([src/lib/pricing.ts](src/lib/pricing.ts), copied in `functions/src/lib/pricing.ts`). Where seasons overlap, the shortest range that prices a tour wins.

### 4b. Import bookings from the old WordPress site

`scripts/import-legacy-bookings.ts` loads the bookings CSV exported from the old admin (`CRMF_bookings_2023-2026.csv`) into the `bookings` collection as `legacy-<old booking #>` docs. Keep the CSV outside the repo; it holds customer contact details (`*.csv` is gitignored).

```bash
npm run import:legacy -- --file ~/Downloads/CRMF_bookings_2023-2026.csv --dry-run   # counts only, no auth
npm run import:legacy -- --file ~/Downloads/CRMF_bookings_2023-2026.csv             # create missing docs
npm run import:legacy -- --file <newer export> --update-existing                    # re-sync at launch
```

What it does:

- Old "confirmed" becomes `completed` (past) or `confirmed` (upcoming). "Reserved" becomes `pending-payment`. "Rescheduled" and "cancelled" become `cancelled` with a reason.
- Tours map to the new slot by start time. Sunset, eco and older 3-hour tours keep their old names.
- Upcoming confirmed and pending bookings hold their seats, so the new calendar won't double-book them.
- Every imported booking is marked as already followed up, so the daily follow-up email job never emails old customers.
- The old order numbers, Stripe transaction IDs and original tour name are kept under `legacy` on each doc.

Limits to know about:

- Imported bookings have no Stripe payment intent. **Don't cancel one through the new admin expecting a refund.** The admin would mark it refunded and email the customer without moving any money. Refund in Stripe directly.
- `--update-existing` overwrites status, date, tour, customer and payment fields from the CSV. Changes made to those fields on the new site are lost; admin notes, access tokens and follow-up markers are kept.

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
| `createCheckoutSession` | POST | Firestore txn → creates `pending-payment` booking → returns Stripe Checkout URL. Refuses impossible dates, departures less than 60 min away (Eastern time), and dates over 365 days out |
| `releaseCheckoutHold` | POST | Token-authenticated. Expires an abandoned Stripe Checkout session, then cancels its `pending-payment` booking so the seats free up immediately |
| `stripeWebhook` | POST | Signature-verified, idempotent; confirms `pending-payment` bookings and triggers the Resend email. A payment on a booking that's already cancelled is refunded in full and emailed to `ADMIN_EMAIL`, never confirmed |
| `resendWebhook` | POST | Signature-verified (Svix), idempotent on `svix-id`. Follows each email the site sends: delivered, bounced, delayed, marked as spam. See [Email log and bounce alerts](#email-log-and-bounce-alerts) |
| `fetchBooking` | POST | Token-authenticated read for `/book/confirmation/[id]` and `/my-booking/[id]` |
| `cancelBooking` | POST | Customer-initiated cancel with Stripe refund per policy. An unpaid booking's Checkout session is expired first (like `releaseCheckoutHold`), with no cancellation email. On a departure Travis closed with "pick a new date", always a full refund |
| `requestReschedule` | POST | Customer reschedule request — emails Travis, logs to `rescheduleRequests` |
| `moveClosedBooking` | POST | Token-authenticated. Moves a booking Travis closed to another open departure of the same kind, no charge (not into a higher-priced date), and emails the updated confirmation |

### Admin (Bearer token, audit-logged)

| Function | Purpose |
|---|---|
| `adminCancelBooking` | Full refund regardless of policy |
| `adminPartialRefund` | Arbitrary partial refund, booking stays active |
| `adminEditBooking` | Edit guest count, names, ages, contact info; capacity-checked |
| `adminRescheduleBooking` | Move to a different date / tour, capacity-checked, optional email |
| `adminMarkBooking` | Flip to `completed` / `no-show` |
| `adminAddNote` | Internal note |
| `adminResendConfirmation` | Re-fire the booking-confirmation email |
| `adminFixBouncedEmail` | Save the customer's corrected email address and send each bounced email again where there's a way to (admin site only) |
| `adminCreateBlackout` | Add a blackout that only stops new bookings. Used by MCP's `create_blackout`; the admin site closes days through the next three |
| `adminPreviewClosure` | What closing these departures would do, per booking and per choice (offer a new date, cancel and refund, leave booked), with the exact customer emails rendered from the real templates. Sends nothing. Returns a confirm token per choice. See [Closing a day](#closing-a-day) |
| `adminConfirmClosure` | Takes a confirm token (and `CANCEL` when anyone is booked). Refuses if anything changed since the preview; otherwise blocks the departures at once and starts the undo window. Nothing is sent, cancelled or refunded until it ends |
| `adminUndoClosure` | Within the undo window: removes the blackout. Nothing was sent |
| `adminSendClosureNow` | Skips the rest of the undo window |
| `adminDeleteBlackout` | Reopen a day. During the undo window it's the same as Undo; after it, cancelled bookings stay cancelled |
| `adminUpdateTour` | Edit tour name, description, standard prices, active, included |
| `adminUpsertRateSeason` | Create / edit a seasonal or holiday rate: name, date range, prices by tour |
| `adminDeleteRateSeason` | Delete a rate season (those dates go back to standard prices) |
| `adminUpdateSettings` | Cancellation policy text, contact email, `closureUndoMinutes` (0–60, default 10), Google review link, wetsuit sizes |
| `adminAddCrewMember` | Add crew: name, role, email, phone, crew emails on/off, optional app password (scrypt hash) |
| `adminUpdateCrewMember` | Change a crew member's name, role, email, phone or crew emails |
| `adminSeedCrew` | Fill an empty crew list with Travis, Lacy, Faith and Megan |
| `adminSetCrewPassword` | Set or replace a crew app password; signs them out on every phone and stops their calendar link |
| `adminRemoveCrewMember` | Remove crew: deletes their sign-ins, notification subscriptions and calendar link |
| `adminSetTripCrew` | Take the crew off one trip so Travis runs it solo (`soloTrips/{date_slot}`), or put them back on |
| `adminSendCrewCalendarLink` | Email a crew member a new calendar subscription link; their old link stops working. See [Crew calendar](#crew-calendar) |
| `adminReviewRequest` | Review requests page: Send now, or Hold (up to 3 days) |
| `adminSendPostTourFollowup` | Resend the thank-you / review email from the booking page |
| `adminTripUploadLink` | A departure's crew photo-upload link |
| `adminDeleteTripPhoto` | Delete an uploaded trip photo (and its Drive copy) |

Every admin write goes to `auditLog/{entryId}` with the admin email, action, target id, and before/after payload.

The [MCP server](#mcp-server) can also call the edit, reschedule, mark, note, resend, blackout, tour, rate-season, inbox and trip-crew functions, using the `MCP_TOKEN` secret instead of Travis's sign-in. Those entries carry `via: 'mcp'` and show as "by automation" in Admin → Activity. The refund, cancel, settings, site-image, testimonial and crew-account functions don't accept the token.

### Firestore triggers

| Function | Fires on | Purpose |
|---|---|---|
| `notifyCrewOfBooking` | `bookings/{id}` written | Push notification to the crew's phones when a booking becomes `confirmed` |
| `notifyCrewOfSoloTrip` | `soloTrips/{id}` created or deleted | Push notification to the crew's phones when Travis takes them off a trip, or puts them back on |
| `sendCrewTestPush` | `crewPushTests/{id}` created | The crew app's "Send a test" button |
| `notifyAdminOfBooking` | `bookings/{id}` written | Push to Travis's admin app: new booking, customer cancellation, bounced email (see [Admin notifications](#admin-notifications)) |
| `notifyAdminOfContactMessage` | `contactMessages/{id}` created | Push: contact-form message |
| `notifyAdminOfRescheduleRequest` | `rescheduleRequests/{id}` created | Push: reschedule request |
| `notifyAdminOfFeedback` | `guestFeedback/{id}` created | Push: private feedback after a trip |
| `notifyAdminOfReviewList` | `reviewLists/{date}` created | Push: tonight's review requests (6 PM) |
| `sendAdminTestPush` | `adminPushTests/{id}` created | Admin → Settings "Send a test" button |
| `onContactMessageCreated` | `contactMessages/{id}` created | Emails Travis the contact-form message |
| `onBlogReviewRequested` | `blogReviewRequests/{slug}` created | Emails Travis grokbot's draft blog post, with the link to approve it |
| `onTripPhotoUploaded` | Storage object in `trips/` | Records a crew upload for the guest gallery; copies it to Google Drive |

### Scheduled jobs

Marina time (America/New_York).

| Function | When | Purpose |
|---|---|---|
| `sendTourRemindersDaily` | 9:00 AM and 5:00 PM | Day-before reminder to everyone going out tomorrow: departure and arrive-by time, marina and directions, what to bring, the Open-Meteo forecast, the manage link. Skips bookings made in the last 12 hours (the confirmation covers them). The 5 PM run retries failures. **Off until launch:** `SEND_TOUR_REMINDERS` in `functions/.env.crmf-99aad` |
| `settleClosedBookings` | 6:00 AM | When Travis closes a departure with "pick a new date", the customer has until 3 days after the closed date to move or take the refund. This cancels and fully refunds the ones who did neither (old-site money gets a note for Travis to refund by hand) |
| `finalizeClosures` | Every minute | Runs closed days whose undo window is up (see [Closing a day](#closing-a-day)), retries a booking that was paid for mid-cancel, and picks up a finalize that died |
| `sendClosureRemindersHourly` | Every hour | One reminder to each customer who hasn't picked a new date or a refund, in the 24 hours before `settleClosedBookings` refunds them. Marker: `closure.reminderSentAt` |

### Automated messages (scheduled, America/New_York)

Every automated message goes through `functions/src/lib/notify.ts` (`notifyCrew`, `notifyGuest`, `notifyOwner`), which emails through Resend today and is where a text-message channel would plug in. Guests only get messages for bookings that are `confirmed` or `completed` and not fully refunded. Each message has a sent-at marker so it goes once.

| Function | When | What | Marker |
|---|---|---|---|
| (stripeWebhook) | booking confirmed | `[CRMF] New booking: …` to the crew | `crewAlertSentAt.booked` |
| (cancelBooking) | customer cancels | `[CRMF] Cancelled: …` to the crew | `crewAlertSentAt.cancelled` |
| (requestReschedule) | customer asks to move | `[CRMF] Reschedule request: …` to the crew | request's `crewAlertSentAt` |
| `retryCrewAlerts` | hourly | Any of the three above that failed in the last 3 hours | |
| `sendCrewSchedule` | 8:00 PM | `[CRMF] Tomorrow: 3 trips, 14 guests` to the crew, with upload links | `crewSchedules/{date}`, `crewScheduleSentAt` |
| `sendTripPrep` | hourly | Trip prep 72 hours before departure (sooner if booked inside 72h; skipped under 12h) | `prepSentAt` |
| `sendDayOfDirections` | every 15 min | Directions 2 hours before departure, never before 6:00 AM | `directionsSentAt` |
| `sendReviewList` | 6:00 PM | `[CRMF] 3 review requests go out at 7:00` to Travis | `reviewLists/{date}`, `reviewListSentAt` |
| `sendReviewRequests` | 7:00 PM | Thank-you + Google review email for today's trips, unless held or didn't sail | `postTourFollowupSentAt` |
| `sendHeldReviewRequests` | hourly | Held requests whose 3 days are up; anything missed | `postTourFollowupSentAt` |
| `sendTripPhotos` | every 15 min | Photo gallery email (9:00 AM the next day; later uploads after an hour's quiet; 8 AM–8 PM) | `photosSentAt` |
| `retryDriveCopies` | hourly | Trip photos not yet in Drive | file's `drive.status` |

Crew = everyone in Admin → Crew with an email and crew emails on. Crew email subjects start with `[CRMF]` so a phone notification rule can catch them.

### Closing a day

Admin → **Close a day**, or **Weather cancel** on the dashboard (today, or the Today / Tomorrow lists), which opens it on that date with Weather picked. Built so Travis can't close the wrong day or the wrong trips by accident:

1. **Pick.** Each departure that day with its time, tour type, bookings and guests; empty ones are dashed. Departures that have left (marina time) can't be picked, and "All trips that day" turns off once one has. A past date can't be closed. More than 3 days out asks "Forecasts change. Cancel this far ahead?" first.
2. **Review.** `adminPreviewClosure` returns "You're cancelling 3 trips on Saturday, Oct 17: 14 guests in 5 bookings", every booking with what happens to it under each choice (refund amount, offer and deadline, left alone, old-site money flagged for a manual refund), and the email each customer would get. Nothing is sent.
3. **Confirm.** Travis types `CANCEL` to enable the red button. The confirm token is 32 random bytes; Firestore keeps only its SHA-256 (`closurePreviews/{hash}`, server-only) with the date, slots, reason, choice, the admin, a 30-minute expiry and a fingerprint of every affected booking (id, status, date, slot, tour, guests, amounts, payment intent, email, closure, `updatedAt`). `adminConfirmClosure` re-checks admin rights, recomputes the fingerprint inside the same transaction that writes the blackout, and refuses with "Something changed since you looked" if it differs. The page then reloads the review.
4. **Undo window.** The blackout goes up at once, so nobody can book those trips. `closureActions/{blackoutId}` (admin-read, functions-write) records who, when, the choice and `finalizeAt`. No booking is changed and nothing is sent until then. A banner on the dashboard and on Close a day counts down with **Undo** and **Send now**. Reopening the day meanwhile is the same as Undo. With nobody booked, or 0 minutes in Settings, it goes through straight away.
5. **Finalize.** Send now or `finalizeClosures` claims the action in a transaction (`pending` → `finalizing`), so they can't both run it. It re-reads the day's bookings, so a checkout paid during the window is included, and runs the chosen option (`runClosureCascade` in `functions/src/lib/close-day.ts`). Each customer email carries a Resend idempotency key, and the offer is stamped `closure.offerEmailedAt`, so a re-run doesn't email anyone twice. A booking paid for as it was being cancelled is tried again two minutes later, up to three times. A finalize that dies is picked up again after 15 minutes.
6. **Crew.** Once per closure (`crewAlert` on the action, claimed in a transaction): a push to the crew app and an email to each `crew/{id}.email`, subject `[CRMF] Weather cancel: Sat Oct 17, 8:00 and 10:30 (14 guests)`. Failures are logged and don't hold up the cancel.

The crew schedule and the dashboard show a closed departure as **Cancelled**, **Being called off** (undo window open) or **Closed, still booked** (Travis left the guests booked to call them).

### Email log and bounce alerts

Every email goes through `sendEmail` in `functions/src/lib/email-log.ts`, which logs it to `emailLog/{resendEmailId}` (kind, booking, recipients, subject, status) and tags it in Resend with its kind and booking id. `resendWebhook` updates that entry as Resend reports on it. The status only moves forward (sent → delayed → delivered → bounced → complained), so an event arriving late doesn't undo a bounce.

When an email to a customer goes wrong, Travis (`ADMIN_EMAIL`, nobody else) gets one email per booking per kind of email, e.g. `[CRMF] Email bounced: call Jane Smith (Sat Oct 17, 10:30 shared)`, with the bad address, a tap-to-call link and the admin link:

| Resend event | What happens |
|---|---|
| `email.bounced`, `bounce.type` = Permanent | Flagged on the booking ("Email bounced" in admin); Travis alerted right away |
| `email.bounced`, any other type (Transient, Undetermined) | Flagged; Travis alerted only if the trip leaves within 48 hours |
| `email.delivery_delayed` | Travis alerted only if the trip leaves within 24 hours |
| `email.complained` | `marketingSuppressed` on the booking, so the daily "thanks for coming" email skips it. No alert |
| `email.delivered` | Recorded on the log entry |

Emails to Travis himself never alert, so an alert that bounces can't set off another. In admin, **Fix email and resend** on the booking saves the right address and sends again whatever bounced (confirmation, updated confirmation, "pick a new date" offer or its reminder, tomorrow's reminder, "thanks for coming"). Weather-cancel emails to the crew are logged too, as `crew`, and never alert. A cancellation or "we got your request" note isn't sent again; the page says to call them.

## Admin notifications

Travis (or any admin) gets a push notification on each phone or computer he turns them on for, under Admin → **Settings** → **Notifications on this device** (the dashboard nudges until they're on). Tapping one opens the page to deal with it:

| Push | Opens |
|---|---|
| New booking (paid; not old-site imports) | the booking |
| Customer cancelled from their booking page, with the refund | the booking |
| Email bounced (whenever the bounce alert email goes, see [Email log and bounce alerts](#email-log-and-bounce-alerts)) | the booking |
| Contact-form message (not ones over the hourly limit) | Messages |
| Reschedule request | Reschedules |
| Private feedback after a trip | the booking |
| Tonight's review requests, at 6 PM | Review requests |

- **iPhone:** notifications only work from a home-screen app. In Safari, open any admin page → Share → **Add to Home Screen** (it installs *Manatee Admin*, `src/app/admin.webmanifest/route.ts`, which opens on the dashboard), open it from the home screen, sign in, then turn notifications on in Settings. An admin page added to the home screen before this existed opens the public site instead; delete it and add it again.
- **How:** `public/admin-sw.js` (scope `/admin`) shows the pushes. Subscriptions are saved per device by `/api/admin/push` in `adminPushSubscriptions` (server-only) with the admin's email, and sent by `functions/src/adminNotifications.ts` with the same VAPID keys as the crew app. Signing out of admin turns that device's notifications off. The emails Travis already gets still go.

## Crew app

Admin → **Crew** is the crew list: Travis (captain) and the mates, each with a role, email, phone (stored for a future text channel; nothing is texted yet) and a crew-emails switch. Everyone with an email and crew emails on gets the `[CRMF]` crew emails (see [Automated messages](#automated-messages-scheduled-americanew_york)). On a fresh install, one tap adds Travis, Lacy, Faith and Megan; the mates' emails are added later.

Anyone with an email can also get a password for the crew app at **`/crew`**, separate from admin: confirmed upcoming tours (time, tour, headcount; no customer names or contact details), a phone notification whenever a tour is booked, and upload links for each trip's photos. They can't change anything else.

- **App passwords:** Admin → **Crew** → **App password**. The page makes up a random password (`k7m4-xq9p-2wht` style) and gives Travis a message with the link, email and password to text them. Passwords are stored as scrypt hashes, so they can't be shown again, only reset. A reset, removal, or taking away their email signs that person out on every phone.
- **Installing:** on iPhone, open `/crew` in Safari → Share → **Add to Home Screen**, then open *Manatee Crew* from the home screen and sign in there. iOS only allows web notifications from a home-screen app (iOS 16.4+), and it keeps that app's sign-in separate from Safari's. On Android, Chrome works as-is; adding to the home screen is optional.
- **Notifications:** after signing in, tap **Turn on notifications**, then **Send a test**. Sign-in sessions last a year; 10 wrong passwords lock an account for 15 minutes.
- **Running a trip solo:** when a trip is too small to pay crew for, Travis switches its **Crew** off under Admin → Crew → **Upcoming trips** (or on today's and tomorrow's cards on the dashboard). The crew app keeps the trip on the schedule, faded, with "No crew needed", and every crew phone gets a notification. Switching it back on sends another. The switch is per departure (date and time), so it stays off if more guests book that trip; their booking notification says "No crew needed".

### Crew calendar

Admin → **Crew** → **Send calendar link** emails that crew member a link that puts every booked departure in their phone's calendar. iPhone: tap the `webcal://` button in the email, then Subscribe. Google Calendar: Other calendars → + → From URL, paste the `https://` link. Crew can also get or replace their own link from the crew app (**Trips in your calendar**).

- **Feed:** `/api/crew-calendar/<token>` (`src/app/api/crew-calendar/[token]/route.ts`, built by `src/lib/crew-calendar/`). The last 14 days and the next 120, one event per departure with guests: `8:00 shared · 6 guests`, `3:30 private · 4 guests`, `7:00 whole-day charter · 5 guests`. A departure Travis closed that had bookings stays in the calendar as `CANCELLED (weather): 8:00 shared` with `STATUS:CANCELLED`. Marina time with an `America/New_York` VTIMEZONE, Pete's Pier as the location, a 60-minute reminder, and a link to the crew app (sign-in needed).
- **Privacy:** counts only. No guest names, phones or emails, because Apple and Google copy subscribed calendars to their servers. The route only reads the booking fields it counts.
- **Links:** a random 32-byte token. Firestore keeps only its SHA-256 (`crewCalendarTokens/{hash}`, and the live hash on `crewCalendars/{crewId}`), all server-only. Sending a new link, resetting the password or removing the crew member kills the old one; a dead link gets a plain 404. The token is in the URL, so it also shows up in App Hosting's request logs: keep access to those logs to Travis and Danny. The feed is sent `Cache-Control: private, no-cache`, so no shared cache keeps a copy.
- **Updates:** each event has a stable UID (`<date>_<slot>@crystalrivermanateefun.com`), and its SEQUENCE goes up whenever its content changes (`crewCalendarDepartures/{date_slot}` keeps a fingerprint per departure). The feed asks for a refresh every 15 minutes, but that's a hint: iPhone checks fairly often, Google Calendar can lag by hours. Push notifications and `[CRMF]` emails stay the source for last-minute changes; the email says so.

### Trip photos

Guests get their trip's photos without Travis doing anything:

1. **Crew upload.** Every departure (date + time slot) has a no-sign-in upload link, `/upload/<token>`. It's in the 8 PM crew email for tomorrow's trips, in the crew app under **Trip photos**, and on the admin booking page. On a phone it opens the camera roll; photos and videos go straight to Firebase Storage under `trips/<date>_<slot>/`, with upload progress. The link stops taking uploads 7 days after the trip. `storage.rules` checks the token against `tripUploadTokens/{token}` on every upload.
2. **Recorded and copied.** `onTripPhotoUploaded` (a Storage trigger) records each file in `tripPhotos/{tripId}/files` for the gallery, then copies it into Google Drive under **Manatee Fun Trip Photos**, one folder per departure, for Grok Bot and the blog. If Drive isn't connected or a copy fails, it's logged and the gallery still works; `retryDriveCopies` tries again hourly (including uploads from before Drive was connected).
3. **Admin review.** Admin → **Trip photos** lists recent departures; each one shows its uploads, with delete (which also removes the Drive copy).
4. **Guest gallery.** `/my-booking/<id>/photos?t=<accessToken>`: the departure's photos and videos with a download button each and **Download all** (a zip). Every party on a shared tour sees the same gallery.
5. **Guest email.** `sendTripPhotos` emails each party on a departure with photos at 9:00 AM ET the day after the trip. Photos that arrive later go out once uploads have stopped for 60 minutes, only between 8 AM and 8 PM ET, up to 7 days after the trip. Marker: `photosSentAt`.

The blog picks photos from these folders too ([Blog (grokbot)](#blog-grokbot)).

Drive uses the `drive.file` scope, so the site can only see the folders and files it created, never the rest of that Drive. Bookkeeping lives in Firestore (`tripPhotos/{date_slot}`, `driveConfig/tripPhotos`, and the connection in `driveConfig/oauth`). If a trip folder is deleted in Drive, the next copy makes a new one.

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

   5. Set the two App Hosting secrets it prints (`GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`) and grant the `default` backend access to them (`firebase apphosting:secrets:grantaccess <name> --backend default`). Then put the client ID in `GOOGLE_DRIVE_CLIENT_ID` in `apphosting.yaml`. The secrets have to exist first, because App Hosting refuses to deploy with a missing secret.
   6. The site copies that connection into `driveConfig/oauth` (server-only) the first time it's needed (an upload page opening, or Admin → Settings), and the Cloud Functions that copy photos read it from there. Admin → Settings → **Google Drive for trip photos** shows the connected account and can disconnect.
   7. After the first copy creates **Manatee Fun Trip Photos** in that Drive, share the folder with whoever else needs it (Travis, grokbot's account). Don't make the folder by hand: with `drive.file` the site can't see folders it didn't create.

   It's connected for `crmf-99aad`. To reconnect (Settings shows a sign-in error), run step 4 again, re-set `GOOGLE_DRIVE_REFRESH_TOKEN`, then delete `driveConfig/oauth` in the Firestore console so the site copies the new token. The **Connect Google Drive** button in Settings needs a *Web application* client with `https://<host>/api/admin/google-drive/callback` listed as a redirect URI; the desktop client above can't do it.

3. **Storage rules.** `storage.rules` reads Firestore (`firestore.get`) to check upload tokens. The first `firebase deploy --only storage` asks to let Storage read Firestore; say yes.

4. **Deploy** rules and functions (`firebase deploy --only firestore:rules,storage,functions`), then push to `main`.

## MCP server

The site is also an [MCP](https://modelcontextprotocol.io) server at **`/api/mcp`**, so Claude (or any MCP client) can check the calendar and handle routine admin work. It runs inside the Next.js app on App Hosting. It reads Firestore directly and makes changes through the same admin Cloud Functions as the admin pages, so it gets the same validation, capacity checks, customer emails and audit log. It speaks Streamable HTTP, stateless, with JSON responses (`POST` only).

| Read-only | Changes |
|---|---|
| `get_availability`: open seats per departure, up to 62 days | `add_booking_note`: appends to the internal notes |
| `list_tours`: schedule, standard prices, seasonal rates, price on a date | `mark_booking`: completed / no-show |
| `list_bookings`: by date range, customer email or search text | `resend_confirmation_email` |
| `get_booking`: guests, contacts, payments, notes, reschedule requests, admin link | `edit_booking`: party size, guest list, contact details |
| `get_day_schedule`: each departure's seats, manifest, and whether it has crew | `reschedule_booking`: capacity-checked, emails the customer by default |
| `list_blackouts` | `create_blackout` / `delete_blackout`: never cancels bookings; lists the ones still on a closed departure |
| `list_contact_messages` | `update_tour`: name, description, included, active, price (dollars) |
| `list_reschedule_requests` | `upsert_rate_season` / `delete_rate_season` |
| | `update_contact_message` / `update_reschedule_request` |
| | `set_trip_crew`: take the crew off a trip, or put them back on; notifies the crew |

It also has the blog tools (`get_blog_brief`, `list_blog_photos`, `view_blog_photo`, `check_blog_post`, `submit_blog_post`). Grokbot reaches those, and only those, at **`/api/mcp/blog`** with a key worked out from `MCP_TOKEN`; see [Blog (grokbot)](#blog-grokbot).

**What it can't do:** refunds, cancellations, blackouts that cancel bookings, site settings, photos, reviews or crew accounts. Answers about a booking include its admin link for those. Customer access tokens are never returned.

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

`apphosting.yaml` declares the env vars the app needs at build + runtime. Create each as an App Hosting secret:

```bash
firebase apphosting:secrets:set NEXT_PUBLIC_FIREBASE_API_KEY
firebase apphosting:secrets:grantaccess NEXT_PUBLIC_FIREBASE_API_KEY --backend <backend-id>
# …repeat for every secret listed in apphosting.yaml
```

Cloud Function secrets are separate (set with `firebase functions:secrets:set NAME`):

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- `RESEND_WEBHOOK_SECRET` (bounce alerts — see [Wire up Resend](#wire-up-resend))
- `APP_BASE_URL` (e.g. `https://crystalrivermanateefun.com`)
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

Once functions are deployed:

```bash
firebase apphosting:secrets:set NEXT_PUBLIC_FUNCTIONS_BASE_URL
# Value: https://us-central1-<project>.cloudfunctions.net
```

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
2. **Functions** — `npm ci` + `npm run build` in `functions/`
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
- [ ] Once the old site's bookings are re-synced, set `SEND_TOUR_REMINDERS=true` in `functions/.env.crmf-99aad` and deploy functions. Until then the day-before reminders stay off, so nobody who booked or cancelled on the old site gets one.
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
