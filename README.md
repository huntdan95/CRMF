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
- A Resend account with a verified sending domain (the free plan is fine for local development; production needs a paid plan, see [Wire up Resend](#wire-up-resend))

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
- **`NEXT_PUBLIC_FUNCTIONS_BASE_URL`** — for local dev pointing at the emulator: `http://127.0.0.1:5001/<project>/us-central1`

The Stripe and Resend keys don't go in `.env.local`: the site reads none of them. The Cloud Functions do, and the functions emulator takes them from `functions/.secret.local` (see step 5).

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

**Where tour data lives.** The schedule (slots, times, durations) is code in `src/lib/tours.ts`. Everything Travis edits is in Firestore: the `tours` docs, plus `rateSeasons` (date ranges with their own per-tour prices). The site reads both through `fetchTourCatalog()` ([src/lib/tours-server.ts](src/lib/tours-server.ts)) and refreshes every 60 seconds, or straight away when Travis saves a change ([Refreshing the site](#refreshing-the-site)); checkout (`createCheckoutSession`) reads the same docs, and both resolve seasonal prices with the same rules ([src/lib/pricing.ts](src/lib/pricing.ts), copied in `functions/src/lib/pricing.ts`). Where seasons overlap, the shortest range that prices a tour wins. Every price is before the 6% Florida sales tax, which the booking page and checkout add on top (`salesTaxOn`, in the same two pricing files).

### 4b. Import bookings from the old WordPress site

`scripts/import-legacy-bookings.ts` loads the bookings CSV exported from the old admin (`CRMF_bookings_2023-2026.csv`) into the `bookings` collection as `legacy-<old booking #>` docs. Keep the CSV outside the repo; it holds customer contact details (`*.csv` is gitignored).

```bash
npm run import:legacy -- --file ~/Downloads/CRMF_bookings_2023-2026.csv --dry-run   # counts only, no auth
npm run import:legacy -- --file ~/Downloads/CRMF_bookings_2023-2026.csv             # create missing docs
npm run import:legacy -- --file <newer export> --update-existing --dry-run          # what the re-sync would change (reads Firestore)
npm run import:legacy -- --file <newer export> --update-existing                    # re-sync at launch
```

What it does:

- Old "confirmed" becomes `completed` (past) or `confirmed` (upcoming). "Reserved" becomes `pending-payment`. "Rescheduled" and "cancelled" become `cancelled` with a reason.
- Old "pending payment" is a WooCommerce order nobody finished paying. With nothing paid it becomes `cancelled` ("Not paid on the old site"), and Reports and the dashboard leave it out like a checkout nobody paid for on the new site; with a deposit or part payment it's treated like "reserved". The dry run lists the upcoming ones, with their old order status, so they can be checked against the old site before the launch re-sync.
- Tours map to the new slot by start time. Whole-day and sunset tours map by name; sunset tours go on the private sunset cruise, so they hold the boat at sundown. That includes ones dated outside the cruise's season (Nov 15 – Mar 31): the cruise isn't sold online then, but a booking on it still has the boat at that day's sunset time, so on a winter evening (it leaves about 4:00 PM in December) it keeps the 3:30 off sale. Sunset, eco and older 3-hour tours keep their old names.
- Upcoming confirmed and pending bookings hold their seats, so the new calendar won't double-book them. The dry run lists them, shows each sunset tour's old start time beside the new sunset departure (marked when it's out of season), and flags any the new calendar wouldn't have allowed together (a private tour sharing its departure, too many shared seats, the whole-day charter with anything else that day, the sunset cruise and the 3:30 on the same evening, late in the season or in winter).
- Every imported booking is marked as already followed up, so the daily follow-up email job never emails old customers.
- The old order numbers, Stripe transaction IDs and original tour name are kept under `legacy` on each doc.

Limits to know about:

- Imported bookings have no Stripe payment intent, so **cancelling one in the new admin refunds nothing.** Nothing is recorded as refunded: the amount paid goes into the booking's private notes as a reminder to refund it by hand, in Stripe directly, and is kept on the booking as `manualRefundCents`. Reports (its own CSV column) and the dashboard count that as given back, not kept, and the customer's booking page says Travis will refund it. Once he has, **Refunded by hand** on the booking's Cancellation card records the date (`manualRefundedAt`; admin site only, not MCP): the admin stops listing it as owed and the booking page says it's been refunded. The amount stays in `manualRefundCents`, so Reports don't change. The customer isn't emailed unless Travis ticks the box, and then the email says he'll be in touch about the money. A reason Travis types with the box unticked stays his: it's saved with `cancellationReasonPrivate` and left off the customer's booking page.
- `--update-existing` overwrites status, date, tour, customer and payment fields from the CSV. Changes made to those fields on the new site are lost; admin notes, access tokens and follow-up markers are kept. So a booking Travis cancelled or moved in the new admin, and not on the old site, goes back to what the old site says, and a cancel's money owed back by hand (and its **Refunded by hand** date) goes with it. Make each of those changes on the old site too before the export. With `--dry-run` as well, it signs in like a real run and reads the existing docs, writing nothing, and lists every booking whose status, departure or money owed back by hand it would change, by id, so they can be checked against the new admin first. Money a new-site cancel left to refund by hand is cut to what the CSV says is still unrefunded (to nothing once the old site shows it refunded), so it isn't counted as given back twice. A booking the CSV puts back after the new admin cancelled it, or moves to another departure, loses any closure, so it isn't offered a new date and cancelled again.

### 5. (Optional) Firebase emulators

```bash
npm install -g firebase-tools
firebase emulators:start            # UI at http://localhost:4000
```

Ports are in `firebase.json`. Set `NEXT_PUBLIC_FUNCTIONS_BASE_URL=http://127.0.0.1:5001/<project>/us-central1` and `FIRESTORE_EMULATOR_HOST=localhost:8080` in `.env.local` to point the app at the emulator.

The functions emulator reads the functions' secrets from `functions/.secret.local` (`NAME=value` lines; `*.local` is gitignored in `functions/`). A secret missing from it is read from the project's Secret Manager instead, when your Google sign-in can: on `crmf-99aad` that's production's Stripe key (live after launch), its Resend account and its `APP_BASE_URL`, so Stripe would send a test payer back to the live site. Put all eight in:

```bash
# functions/.secret.local
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…     # the one `stripe listen --forward-to <emulated stripeWebhook URL>` prints
RESEND_API_KEY=re_…
RESEND_FROM_EMAIL=…               # on a domain verified in that Resend account
RESEND_WEBHOOK_SECRET=whsec_…     # any placeholder, unless you test bounce alerts
APP_BASE_URL=http://localhost:3000
MCP_TOKEN=…                       # the same value as MCP_TOKEN in .env.local
VAPID_PRIVATE_KEY=…
```

## Cloud Functions

HTTPS endpoints, plus Firestore triggers and scheduled jobs. Public ones use origin-allow-list CORS; admin ones require a Firebase ID-token Bearer header. The two webhooks (`stripeWebhook`, `resendWebhook`) are checked by signature instead.

### Public / customer-facing

| Function | Verb | Purpose |
|---|---|---|
| `getAvailability` | GET | Live slot capacity + month blackouts for the calendar UI |
| `createCheckoutSession` | POST | Creates the Stripe Checkout session → Firestore txn checks seats and creates the `pending-payment` booking with its session id (so Stripe's expiry always frees the hold) → returns the Checkout URL. The session has two line items, the tour at its price and "Florida sales tax (6%)" on that price (`salesTaxOn`), and the booking records both (`subtotalCents`, `salesTaxCents`). `amountPaidCents` is what Stripe took, the tax included, and every refund is worked out from it, so the tax goes back with the fare. Refuses impossible dates, departures less than 60 min away (Eastern time), and dates over 365 days out. Card only (`payment_method_types: ['card']`; Apple Pay and Google Pay come with it), so a bank debit that takes days to clear, and can fail after the trip, can't be picked even if it's turned on in the Stripe dashboard. One visitor can have 3 unpaid checkouts open: a 4th started within 35 minutes of them gets a 429 (`reason: 'too-many-checkouts'`), and the booking page tells them to finish one, wait for them to lapse, or call Travis. The checkout being replaced (`previousBooking`, with its token) doesn't count. A visitor is their IP address (an IPv6 address's /64): the last `X-Forwarded-For` entry that isn't one of Google's own proxy addresses (those come after the visitor's and can't be forged), never one the client wrote or Express's `req.ip`. Only a SHA-256 of it is kept, as `checkoutIpHash` on the booking; with no usable address nobody is refused. The count is read in the booking transaction, so two checkouts at once can't both get the last place. When it turns someone away, `ADMIN_EMAIL` gets `[CRMF] Checkout turned away: Sam Rivera (Sat Oct 17, 8:00 shared)` with their contact details and the open checkouts, at most once a day per visitor (Resend idempotency key `checkout-limit/<hash>/<marina date>`). See [functions/src/lib/checkout-limit.ts](functions/src/lib/checkout-limit.ts) |
| `releaseCheckoutHold` | POST | Token-authenticated. Expires an abandoned Stripe Checkout session, then cancels its `pending-payment` booking so the seats free up immediately |
| `stripeWebhook` | POST | Signature-verified, idempotent; confirms `pending-payment` bookings and triggers the Resend email. A payment on a booking that's already cancelled is refunded in full and emailed to `ADMIN_EMAIL`, never confirmed. If that email fails, the booking keeps it (`paidAfterCancellationAlert`) and the webhook fails, so Stripe's next delivery sends just the email (Resend idempotency key `paid-after-cancel/<booking>/<payment>`), not a second refund. A booking paid less than 60 min before its departure (the online cutoff, marina time, sunset cruise included) or after it left also emails `ADMIN_EMAIL` right away, `[CRMF] Last-minute booking: Sat Oct 17, 8:00 — paid 7:29 AM`, with a tap-to-call link and the admin link; it goes after the customer's confirmation, once per booking, and a failure is only logged. A checkout that started before Travis closed its departure and is paid after is confirmed (the money is taken), but the customer isn't sent the confirmation: a closure that cancels them or offers a new date takes them with the others, and its email is the only one they get. Otherwise (closed from MCP, left booked, or a closure that went out before they paid) they get `Payment received, but Capt. Travis has had to close your Saturday, Oct 17 tour` instead (kind `closedTrip`, copied to Travis, once per booking): what they paid, the trip's date and time (the sunset cruise's that day), that he'll be in touch shortly to move them or refund them in full, his number to tap and their booking page. If it fails, Stripe's retry sends it, as for the confirmation. Travis gets `[CRMF] Paid for a trip you closed: Sat Oct 17, 8:00 — Jane Smith` right away instead of the last-minute email, once per booking, even when the customer's email fails: it says what they were told; call them, then move them or cancel and refund them in full, which emails them (or reopen the trip, which sends them the confirmation). During a closure's undo window it says the closure takes them, and an undo sends them the confirmation; a closure already going out (retrying a booking paid for mid-cancel) emails him nothing more |
| `resendWebhook` | POST | Signature-verified (Svix), idempotent on `svix-id`. Follows each email the site sends: delivered, bounced, delayed, marked as spam. See [Email log and bounce alerts](#email-log-and-bounce-alerts) |
| `fetchBooking` | POST | Token-authenticated read for `/book/confirmation/[id]` and `/my-booking/[id]`. Leaves out admin-only fields, and a cancel reason Travis kept private. `departureClosed` when a closed day covers the trip of a booking still on it with no closure offer (Travis left them booked), a reopened trip's `refundGraceUntil` or not. `closurePending` (`choice` and the `message` `cancelBooking` would give) while a closure that cancels them or offers a new date is in its undo window or going out; null for "leave them booked", which keeps the trip on. `hasTripPhotos` once the crew have uploaded photos for a trip the booking went out on (not one Travis closed, not a no-show): only then does the booking page show **Your trip photos** |
| `cancelBooking` | POST | Customer-initiated cancel with Stripe refund per policy. The cancel dialog sends the refund it showed (`expectedRefundCents`); if the policy now gives less (the dialog sat open past the 72-hour line), nothing is cancelled and a 409 with code `refund-changed` returns the new amount to confirm. An unpaid booking's Checkout session is expired first (like `releaseCheckoutHold`), with no cancellation email. On a departure Travis closed with "pick a new date", always a full refund, recorded as the customer's cancel (`cancelledBy: 'customer'`, so admin, MCP and Travis's push tell it from the refund `settleClosedBookings` sends when the deadline passes); that dialog sends the full amount as `expectedRefundCents` too, so if the closure came off before they confirmed it gets the policy's figure back instead of a cancellation for less. On a trip Travis reopened after that offer, a full refund until the offer's deadline (`refundGraceUntil`, see [Closing a day](#closing-a-day)), which the dialog shows too. Old-site bookings are refused; the page tells those customers to call Travis. While Travis is closing the departure (undo window open, or going out) it's a 409 with code `closure-pending`, checked again as the cancel is written, unless their full refund has already gone to Stripe, or the closing leaves them booked and a reopen's full refund (`refundGraceUntil`) still stands for them. Once he has closed it and left them booked (no closure on the booking, a blackout over the trip, as after "leave them booked" or MCP's `create_blackout`), a paid booking gets a 409 with code `departure-closed` instead ("Capt. Travis has closed this trip and will be in touch with you directly…"), checked the same way, whatever the policy would refund; not while a reopened trip's `refundGraceUntil` still stands. The booking page shows that message in place of the Cancel button (`departureClosed` from `fetchBooking`); in a reopened trip's grace it shows the message with the Cancel button and the grace line beside it, since the trip is closed either way. While a closure that cancels them or offers a new date is pending, the page shows the `closure-pending` message (`closurePending` from `fetchBooking`) with neither Cancel nor **Request a different date**. If Stripe turns the refund down (a payment too old to refund, or disputed), nothing is cancelled: a 409 with code `refund-refused` tells the customer Travis will be in touch, and Travis is emailed Stripe's reason (`[CRMF] Refund refused: call …`, once a day per booking). Stripe's 409 (another request refunding the booking under the same key at that moment, like the closure going out) isn't a refusal: a 409 asks them to reload in a minute. The booking records what this cancel refunded (`cancelRefundCents`), which the crew alert and Travis's push give, not refunds he made before. If Travis cancelled it first, the answer is `alreadyCancelled` and no email goes out |
| `requestReschedule` | POST | Customer reschedule request — emails Travis, logs to `rescheduleRequests`. Only for a trip that's going ahead (confirmed, or an old-site deposit, as for waivers): a checkout nobody has paid for, which anyone can start for any email address, gets a 409 and sends nothing. While Travis is calling the trip off (a closure that cancels them or offers a new date, in its undo window or going out) it's a 409 with code `closure-pending` and `cancelBooking`'s message, so no request is left open for a booking about to be cancelled or offered a new date; "leave them booked" keeps the trip on, so a request goes through then |
| `moveClosedBooking` | POST | Token-authenticated. Moves a booking Travis closed to another open departure of the same kind, no charge (not into a higher-priced date), and emails the updated confirmation. Ends a reopened trip's full-refund grace (`refundGraceUntil`), as Travis moving it does |
| `submitFeedback` | POST | Token-authenticated. "Tell Travis privately", the form at `/feedback/<id>?t=` that the thank-you email links next to the Google review link: saves the message (up to 4,000 characters) in `guestFeedback` (admin-read), where the admin booking page shows it under **Private feedback**, and emails Travis `[CRMF] Private feedback from Jane Smith (Sat Oct 17, 8:00 shared)` straight away, with replies going to the guest, plus an admin push. Only after a trip that happened (completed or no-show, or going ahead and the boat is back): an unpaid checkout, a cancelled booking or a trip still to come gets a 409. Five messages per booking; a sixth gets a 429 with his number to call instead. If the email fails, the hourly `sendHeldReviewRequests` tries it again for a day |

### Admin (Bearer token, audit-logged)

| Function | Purpose |
|---|---|
| `adminCancelBooking` | Full refund regardless of policy. A checkout still being paid for is expired at Stripe and marked `failed` (`adminCancelOne`, which closing a day uses too), as when the customer leaves it or Stripe expires it, so Reports and the dashboard leave it out like those. If the booking is cancelled another way just as Stripe takes the refund, the refund stands: it's recorded on the booking with a note, audited as `booking.refund`, and returned with `alreadyCancelled` |
| `adminPartialRefund` | Arbitrary partial refund, booking stays active |
| `adminRecordManualRefund` | "Refunded by hand": records (`manualRefundedAt`) that Travis has paid back the old-site money a cancellation left owing (`manualRefundCents`). No money moves. Admin site only, not `MCP_TOKEN` |
| `adminResetBookingLinks` | "Reset their booking links", for when an email went to the wrong person: gives the booking a new `accessToken` in a transaction, so everything made from the old one stops working: the `/my-booking` and `/book/confirmation` links (`fetchBooking`, `cancelBooking`, `requestReschedule`, `moveClosedBooking`), the `.ics` download and the self-service link inside one already saved, the photo gallery (`/my-booking/<id>/photos?t=`, and the photos email's `?k=`, a hash of the token; their downloads too), the private-feedback link in the "thanks for coming" email (`/feedback/<id>?t=`, checked by `submitFeedback`), and every waiver signing link (`?k=` is a hash of the token), forwarded ones included. Signed waivers, and each signer's link to their own copy, are untouched. Then emails the new links to the booking's current address: the confirmation for a confirmed trip still to come on a departure Travis hasn't closed, the "pick a new date" offer while they're choosing after a closure, or, after the trip, the photos email again with the new gallery link if they'd had one (and the gallery still has something in it); nothing for a cancelled booking, a finished one with no photos email, an old-site reservation before its trip, a departure he closed and left them booked on, one past its choose-by date or with no address, and the answer (`email`) says which, or why not. The "thanks for coming" email isn't sent again: for its feedback link, use **Send "thanks for coming" email** on the booking afterwards, or call them. Refused while the customer is still paying online (Stripe returns them with the old token). Audit-logged without the token. Admin site only, not `MCP_TOKEN` |
| `adminEditBooking` | Edit guest count, names, ages, wetsuit sizes (one Travis doesn't stock is refused with the list of those he does), contact info; capacity-checked (an old-site booking with no party size already holds the whole boat, so recording its size never needs seats). The customer's email address only from the admin site, not with `MCP_TOKEN`. Refuses a booking whose online payment hasn't gone through: the checkout charges what it was opened for |
| `adminRescheduleBooking` | Move to a different date / tour that hasn't left yet, with the same seat rules as online booking (the booking's own seats aside); optional email, and the answer says whether it went (`emailed`, and `reason` if not). Only a confirmed booking is emailed, not an old-site reservation. A move settles a closure offer (`closure`) and ends a reopened trip's full-refund grace (`refundGraceUntil`). Refuses if the booking was cancelled or moved meanwhile, a booking whose online payment hasn't gone through, and one with no party size onto a shared tour |
| `adminMarkBooking` | Flip to `no-show` once the departure has left, or `completed` once it's back (marina time; marked while it's still out, the boat would go back on sale): a confirmed booking or an old-site reservation, not one on a departure Travis closed while the customer is still choosing (unless a reopen under the previous version left that closure behind; marking one takes the closure off, see [Closing a day](#closing-a-day)), nor one on a departure a blackout still covers (he left them booked, closed it from MCP, or they paid after it closed): that trip didn't go out, and he moves or cancels it instead, after its date too. Unless it went out after all: from the admin booking page (not with `MCP_TOKEN`), `ranAnyway` marks it once it has left, with a note on the booking and the covering blackouts in the audit entry; not while a closure of the departure is in its undo window or going out (see [Closing a day](#closing-a-day)) |
| `adminAddNote` | Internal note. Replaces the notes, refused if they've changed since `previousNotes` (the admin note window), or adds a line with `append` (MCP). A save adds at most 2,000 characters (`NOTE_MAX`); the notes can be longer, as the site adds lines of its own and old-site imports bring theirs, and still save |
| `adminResendConfirmation` | Re-fire the booking-confirmation email. Confirmed bookings only, not once the trip date has passed or for a departure Travis closed |
| `adminSendWaiverReminder` | **Send waiver reminder** on the booking page: emails the booker who's still to sign, even if a reminder already went (the page asks first) and before launch. Not when everyone has signed, there's no email address, or it isn't an upcoming trip that's going ahead |
| `adminFixBouncedEmail` | Save the customer's corrected email address and send each bounced email again where there's a way to (admin site only) |
| `adminCreateBlackout` | Add a blackout that only stops new bookings. Used by MCP's `create_blackout`; the admin site closes days through the next three. Turns away a past date or a departure that has already left with a 400 saying which, as Close a day does: a blackout over a trip that ran would have it treated as one that didn't (no review request, no marking it). With people still going out on those trips, the crew get the same "Closed" alert as a day left booked, once (`crewAlert` on the blackout, which has no closure action); `crewTold` says whether it reached them all |
| `adminPreviewClosure` | What closing these departures would do, per booking and per choice (offer a new date, cancel and refund, leave booked), with the exact customer emails rendered from the real templates. Sends nothing. Returns a confirm token per choice. See [Closing a day](#closing-a-day) |
| `adminConfirmClosure` | Takes a confirm token (and `CANCEL` when anyone is booked). Refuses if anything changed since the preview; otherwise blocks the departures at once and starts the undo window. Nothing is sent, cancelled or refunded until it ends |
| `adminUndoClosure` | Within the undo window: removes the blackout. Nothing was sent. Anyone an earlier closure of the same trips left waiting on a new date (it was reopened while this one covered them) goes back on their trip: returned as `restored`, with `crewTold` as for a reopen. Anyone who paid during the window is sent the confirmation held back from them (`confirmationsSent`; `confirmationsFailed` for Travis to resend). Anyone still booked on a trip it covered that left during the window is named (`alreadyLeft`): that trip now counts as having run. `stillClosed` (`all` or `some`, also kept on the action) when another closed day still covers its trips, so the banner and Close a day say the day is still closed by that one instead of open for booking again |
| `adminSendClosureNow` | Skips the rest of the undo window |
| `adminDeleteBlackout` | Reopen a day. During the undo window it's the same as Undo; after it, cancelled bookings stay cancelled and anyone still picking a new date goes back on their trip. Refused (409, naming them) while a trip it closed has left with someone still booked on it. `stillClosed`, as for Undo, when another closed day still covers its trips. See [Closing a day](#closing-a-day) |
| `adminUpdateTour` | Edit tour name, description, standard price, active, included. The price is per person on a shared tour and for the boat on a private one; setting the other is refused, since checkout never reads it |
| `adminUpsertRateSeason` | Create / edit a seasonal or holiday rate: name, date range, prices by tour |
| `adminDeleteRateSeason` | Delete a rate season (those dates go back to standard prices) |
| `adminUpdateSettings` | Cancellation policy text, contact email, `closureUndoMinutes` (0–60, default 10), Google review link, wetsuit sizes (saving the policy text or the sizes refreshes the site, so `/book` offers the new sizes at once). Whatever sizes are listed, a guest on a swim tour can also pick **No wetsuit (not swimming)** (a baby riding along), stored as `None`: checkout and `adminEditBooking` accept it, and the crew's tally counts it apart ("1 not swimming") |
| `adminUpdateSiteImage` | Admin → Photos: after the browser uploads a photo to Storage (`public/`, admin-only), saves it as `siteImages/{slot}` so the site shows it, and refreshes the site |
| `adminDeleteSiteImage` | Puts a photo slot back to its built-in picture (the Storage file stays), and refreshes the site |
| `adminUpsertTestimonial` | Add or edit a testimonial, and refresh the site |
| `adminDeleteTestimonial` | Delete a testimonial, and refresh the site |
| `adminUpdateContactMessage` | Messages: mark a contact-form message new, replied or archived |
| `adminUpdateRescheduleRequest` | Reschedules: mark a request open, accepted, declined or resolved, with an optional note. Doesn't move the booking (that's `adminRescheduleBooking`) |
| `adminAddCrewMember` | Add crew: name, role, email, phone, crew emails on/off, optional app password (scrypt hash) |
| `adminUpdateCrewMember` | Change a crew member's name, role, email, phone or crew emails. Clearing their email also clears their app password, signs them out on every phone, and stops their notifications and their calendar link |
| `adminSeedCrew` | Fill an empty crew list with Travis, Lacy, Faith and Megan |
| `adminSetCrewPassword` | Set or replace a crew app password; signs them out on every phone and stops their calendar link |
| `adminRemoveCrewMember` | Remove crew: deletes their sign-ins, notification subscriptions and calendar link |
| `adminSetTripCrew` | Take the crew off one trip so Travis runs it solo (`soloTrips/{date_slot}`), or put them back on |
| `adminSendCrewCalendarLink` | Email a crew member a new calendar subscription link; their old link stops working. See [Crew calendar](#crew-calendar) |
| `adminReviewRequest` | Review requests page: Send now, or Hold (up to 3 days) |
| `adminSendPostTourFollowup` | Resend the thank-you / review email from the booking page |
| `adminTripUploadLink` | A departure's crew photo-upload link |
| `adminDeleteTripPhoto` | Delete an uploaded trip photo (and its Drive copy), keep that copy off the blog, and say which blog posts already have it |

Every admin write goes to `auditLog/{entryId}` with the admin email, action, target id, and before/after payload.

The [MCP server](#mcp-server) can also call the edit, reschedule, mark, note, resend, blackout, tour, rate-season, inbox and trip-crew functions, using the `MCP_TOKEN` secret instead of Travis's sign-in. Those entries carry `via: 'mcp'` and show as "by automation" in Admin → Activity. The refund, cancel, settings, site-image, testimonial and crew-account functions don't accept the token.

### Refreshing the site

The public pages are cached and refresh every 60 seconds. To show a change at once, the functions that change what the pages show call the site's **`POST /api/revalidate`** at `APP_BASE_URL` once the change is saved: `adminUpdateTour`, `adminUpsertRateSeason`, `adminDeleteRateSeason`, the site-image and testimonial functions, and `adminUpdateSettings` when the cancellation policy text or the wetsuit sizes change ([functions/src/lib/site-refresh.ts](functions/src/lib/site-refresh.ts)). The route ([src/app/api/revalidate/route.ts](src/app/api/revalidate/route.ts)) takes a key worked out from `MCP_TOKEN` (an HMAC, like the [blog key](#blog-grokbot), compared in constant time), so there's no other secret to keep, and the key opens nothing else. It refreshes every page under the root layout: both public layouts put the tour catalog on every page they render, and the share image and sitemap read it too. Pages render again on their next visit.

If the site can't be reached, the function logs it and the change still saves; the 60-second refresh catches up. The refresh clears the cache of the App Hosting instance that answers, so with a second instance running (or a cached copy in front of it) a page can lag up to a minute. Admin → Tours and Admin → Photos say "now, or within a minute at most".

### Firestore triggers

| Function | Fires on | Purpose |
|---|---|---|
| `notifyCrewOfBooking` | `bookings/{id}` written | Push notification to the crew's phones when a booking becomes `confirmed`. Inside the online cutoff it starts with how soon the trip leaves ("Leaves in 25 min"); on a departure a blackout covers (paid for after Travis closed it), with "On a trip Travis closed:" instead |
| `notifyCrewOfSoloTrip` | `soloTrips/{id}` created or deleted | Push notification to the crew's phones when Travis takes them off a trip, or puts them back on |
| `sendCrewTestPush` | `crewPushTests/{id}` created | The crew app's "Send a test" button |
| `notifyAdminOfBooking` | `bookings/{id}` written | Push to Travis's admin app: new booking, customer cancellation, bounced email (see [Admin notifications](#admin-notifications)) |
| `notifyAdminOfContactMessage` | `contactMessages/{id}` created | Push: contact-form message |
| `notifyAdminOfRescheduleRequest` | `rescheduleRequests/{id}` created | Push: reschedule request |
| `notifyAdminOfFeedback` | `guestFeedback/{id}` created | Push: private feedback after a trip |
| `notifyAdminOfReviewList` | `reviewLists/{date}` created | Push: tonight's review requests (6 PM), or tomorrow morning's when the only trip is back after 7:00 |
| `sendAdminTestPush` | `adminPushTests/{id}` created | Admin → Settings "Send a test" button |
| `onContactMessageCreated` | `contactMessages/{id}` created | Emails Travis the contact-form message, with a link to Messages in admin; replying goes to the sender. Past the site's hourly email limit the message is saved without one. The form's hourly limits are counted in `rateLimits` (per sender and site-wide, a doc per hour), which a TTL policy on `expiresAt` (in `firestore.indexes.json`, deployed with the indexes) has Firestore delete once their hour is over |
| `onWaiverSigned` | `waivers/{id}` created | Emails the signer their signed waiver, attaching the PDF stored with it, so their copy is byte-for-byte the record (kind `waiverCopy`, to the address they typed when signing, replies to Travis). Claimed on the waiver so it goes once; a failed send is retried for 12 hours |
| `onBlogReviewRequested` | `blogReviewRequests/{slug}` created | Emails Travis grokbot's draft blog post, with the link to approve it. A request whose email fails is kept, with the error: Admin → Blog says the email didn't go out, and `retryBlogReviewEmails` sends it again. Each draft's email has its own Resend idempotency key (`blog-review/<slug>/<token hash>`), so a send whose answer was lost isn't emailed twice. The slug comes from the request itself: one made while a failed request is still there gets an id of its own |
| `onTripPhotoUploaded` | Storage object in `trips/` | Records a crew upload for the guest gallery; copies it to Google Drive |

### Scheduled jobs

Marina time (America/New_York).

| Function | When | Purpose |
|---|---|---|
| `sendTourRemindersDaily` | 9:00 AM and 5:00 PM | Day-before reminder to everyone going out tomorrow: departure and arrive-by time, marina and directions, what to bring, the Open-Meteo forecast, the manage link. Skips bookings made in the last 12 hours (the confirmation covers them) and departures Travis has closed or is closing (a blackout covers them; reopened before 5 PM, they get it then). The 5 PM run retries failures. **Off until launch:** `SEND_TOUR_REMINDERS` in `functions/.env.crmf-99aad` |
| `sendWaiverReminders` | 3:00 PM | To the booker of each trip going out tomorrow whose party hasn't all signed waivers: who's still to sign (with no party size on file, just how many have signed and a nudge to check everyone has), and the signing link. Once per departure, so a booking moved to another day gets one for that day too. Skips departures Travis has closed or is closing, like the tour reminder, and bookings with no email address (some old-site ones; the button says so). Marker: `waiverReminderSentFor`. **Send waiver reminder** on the booking page sends one any time. **Off until launch**, with the tour reminder: `SEND_TOUR_REMINDERS` |
| `settleClosedBookings` | 6:00 AM | When Travis closes a departure with "pick a new date", the customer has until 3 days after the closed date to move or take the refund. This cancels and fully refunds the ones who did neither (old-site money gets a note for Travis to refund by hand), and emails them that the deadline passed. If Resend refuses that email, the booking keeps what it says (`deadlineEmail`) and the next morning's run sends it (Resend idempotency key `deadline-cancel/<booking>`). One Travis moves, or puts back on its trip, as it runs is left alone. That includes a closure a reopen left behind (see [Closing a day](#closing-a-day)), as that reopen promised, unless Travis marked the trip. It reads only confirmed and pending-payment bookings with `closure.decideBy` before today (a composite index in `firestore.indexes.json`), not every booking a closure ever touched |
| `finalizeClosures` | Every minute | Runs closed days whose undo window is up (see [Closing a day](#closing-a-day)), retries a booking that was paid for mid-cancel, and picks up a finalize that died |
| `sendClosureRemindersHourly` | Every hour | One reminder to each customer who hasn't picked a new date or a refund, in the 24 hours before `settleClosedBookings` refunds them, a closure a reopen left behind included. Marker: `closure.reminderSentAt` |

### Automated messages (scheduled, America/New_York)

Every automated message goes through `functions/src/lib/notify.ts` (`notifyCrew`, `notifyGuest`, `notifyOwner`), which emails through Resend today and is where a text-message channel would plug in. Guests only get messages for bookings that are `confirmed` or `completed` and not fully refunded. Trip prep, directions and the review request also skip a trip Travis has closed or is closing (a closure on the booking, or a blackout over the departure: `onOpenDepartures`); the review request still goes if he marks the trip completed. Old-site bookings get none of them (trip prep, directions, the photo email) until `SEND_TOUR_REMINDERS` is on (see the [launch checklist](#launch-checklist)), and never the review request: the importer marks it sent. Each message has a sent-at marker so it goes once.

| Function | When | What | Marker |
|---|---|---|---|
| (stripeWebhook) | booking confirmed | `[CRMF] New booking: …` to the crew (`New booking on a closed trip` for a checkout paid after Travis closed it; `(6 on the boat)` counts everyone going, `6+` with an old-site party of unknown size; `· No crew needed` on a trip Travis runs solo) | `crewAlertSentAt.booked` |
| (cancelBooking) | customer cancels | `[CRMF] Cancelled: …` to the crew (not for the refund after Travis closed their trip: the closure's alert told them) | `crewAlertSentAt.cancelled` |
| (requestReschedule) | customer asks to move | `[CRMF] Reschedule request: …` to the crew (trips going ahead only) | request's `crewAlertSentAt` |
| `retryCrewAlerts` | hourly | Any of the three above that failed in the last 3 hours | |
| `sendCrewSchedule` | 8:00 PM (again 9 and 10 PM) | `[CRMF] Tomorrow: 3 trips, 14 guests` to the crew, with upload links. Everyone going out counts, as in the crew app (old-site reservations, `14+ guests` or `party size unknown` without a party size on file), but not those asked to pick a new date. A departure a blackout covers is listed as **Closed** or **Being called off**, without an upload link (`Tomorrow: 2 trips, 9 guests, 1 closed`); one Travis runs solo says No crew needed. The 9 and 10 PM runs only send to crew members an earlier one couldn't reach (`crewFailedIds`), with the trips as they stand by then; a booking made after 8 PM on a day with no trips doesn't start one. `sentAt` is when a run last reached someone, which an undo or reopen reads to tell whether the crew heard a trip was off ([Closing a day](#closing-a-day)) | `crewSchedules/{date}`, `crewScheduleSentAt` |
| `sendTripPrep` | hourly | Trip prep 72 hours before departure (sooner if booked inside 72h; skipped under 12h) | `prepSentAt` |
| `sendDayOfDirections` | every 15 min | Directions 2 hours before departure, never before 6:00 AM | `directionsSentAt` |
| `sendReviewList` | 6:00 PM | `[CRMF] 3 review requests go out at 7:00` to Travis; a sunset cruise back after 7:00 is listed as going tomorrow morning | `reviewLists/{date}`, `reviewListSentAt` |
| `sendReviewRequests` | 7:00 PM | Thank-you + Google review email for today's trips once the boat is back, unless held or didn't sail. Its GoPro line says the photos come in a separate email, links their gallery instead once that email has gone (`photosSentAt`: a held or resent request), and is left out once it can't come any more (over 7 days after the trip) | `postTourFollowupSentAt` |
| `sendHeldReviewRequests` | hourly | Held requests whose 3 days are up; anything missed, 9 AM–8 PM, such as a sunset cruise still out at 7:00 ("thanks for coming out… yesterday") | `postTourFollowupSentAt` |
| `sendTripPhotos` | every 15 min | Photo gallery email (9:00 AM the next day; later uploads after an hour's quiet; 8 AM–8 PM). Not for a departure Travis closed and left them booked on, unless he's marked it completed | `photosSentAt` |
| `retryDriveCopies` | hourly | Trip photos not yet in Drive | file's `drive.status` |
| `retryBlogReviewEmails` | hourly | A blog review email Resend refused, while its draft still waits for Travis (a request for a draft reviewed or replaced since is deleted) | the request, deleted once sent |

Crew = everyone in Admin → Crew with an email and crew emails on. Crew email subjects start with `[CRMF]` so a phone notification rule can catch them.

### Closing a day

Admin → **Close a day**, or **Weather cancel** on the dashboard (today, or the Today / Tomorrow lists), which opens it on that date with Weather picked. Built so Travis can't close the wrong day or the wrong trips by accident:

1. **Pick.** Each departure that day with its time, tour type, bookings and guests (`4+ guests`, or `party size unknown`, where an old-site booking has no party size on file, as the crew see it; the review's headline, the countdown banner and the dashboard say it the same way); empty ones are dashed. The sunset cruise is listed in its season, or out of it when someone is booked on it (an old-site sunset tour). Departures that have left (marina time) can't be picked, and "All trips that day" turns off once one has. A past date can't be closed. More than 3 days out asks "Forecasts change. Cancel this far ahead?" first.
2. **Review.** `adminPreviewClosure` returns "You're cancelling 3 trips on Saturday, Oct 17: 14 guests in 5 bookings", every booking with what happens to it under each choice (refund amount, offer and deadline, left alone, old-site money flagged for a manual refund), and the email each customer would get. Nothing is sent.
3. **Confirm.** Travis types `CANCEL` to enable the red button. The confirm token is 32 random bytes; Firestore keeps only its SHA-256 (`closurePreviews/{hash}`, server-only) with the date, slots, reason, choice, the admin, a 30-minute expiry and a fingerprint of every affected booking (id, status, date, slot, tour, guests, amounts, payment intent, email, closure, `updatedAt`). `adminConfirmClosure` re-checks admin rights, recomputes the fingerprint inside the same transaction that writes the blackout, and refuses with "Something changed since you looked" if it differs. The page then reloads the review.
4. **Undo window.** The blackout goes up at once, so nobody can book those trips. `closureActions/{blackoutId}` (admin-read, functions-write) records who, when, the choice and `finalizeAt`. No booking is changed and nothing is sent until then. A banner on the dashboard and on Close a day counts down with **Undo** and **Send now**. Reopening the day meanwhile is the same as Undo. With nobody booked, or 0 minutes in Settings, it goes through straight away.
5. **Finalize.** Send now or `finalizeClosures` claims the action in a transaction (`pending` → `finalizing`), so they can't both run it. It re-reads the day's bookings, so a checkout paid during the window is included (it isn't sent the confirmation or anything else when paid: the closure's email is the one it gets, see `stripeWebhook`), and runs the chosen option (`runClosureCascade` in `functions/src/lib/close-day.ts`). A booking moved to another trip while it runs is left alone: each is checked again as it's marked or cancelled. Each customer email carries a Resend idempotency key, and the offer is stamped `closure.offerEmailedAt`, so a re-run doesn't email anyone twice. A booking paid for as it was being cancelled is tried again two minutes later, up to three times. A finalize that dies is picked up again after 15 minutes; each booking it cancelled is stamped with its id (`cancelledByClosure`) and what it refunded (`closureRefundCents`), so the rerun counts those, with their own refunds, and not ones Travis or an expired checkout cancelled meanwhile. A closure confirmed before that stamp existed (no `stampsCancels` on the action) counts, as it did then, whatever was cancelled from admin after it was confirmed. A booking moved or cancelled another way just as its refund went out is reported as refunded, with what to check, not as one to cancel.
6. **Crew.** Once per closure (`crewAlert` on the action, claimed in a transaction): a push to the crew app and an email to each crew member with an email and crew emails on, subject `[CRMF] Weather cancel: Sat Oct 17, 8:00 and 10:30 (14 guests)` (`14+ guests`, or `party size unknown`, with old-site bookings that have no party size on file). On a day left booked it counts those going out: not a checkout still in Stripe (paid, it reaches the crew as a new booking on a closed trip) nor anyone an earlier closure asked to pick a new date. Failures are logged and don't hold up the cancel. A day closed from MCP's `create_blackout` with people going out on it sends the same "Closed" alert straight away, claimed on its blackout (it has no closure action; `alertCrewClosedFromMcp`), which also records whom it left booked, without names (`crewAlert.kept`), as a closure action's result does.

The crew schedule and the dashboard show a closed departure as **Cancelled** (one left booked too, from admin or MCP, once Travis has cancelled or moved everyone it left on it, as the crew calendar shows it; not one he marks as having gone out after all), **Being called off** (undo window open) or **Closed, still booked** (Travis left the guests booked to call them); the 8 PM crew email marks the last two the same way. A departure two closed days cover (one left booked, then closed again to cancel, say) is **Being called off** while either is in its undo window, on every screen, MCP's `get_day_schedule` included. The dashboard's **Next tour out** skips a departure a closed day covers: it isn't going out. Those guests' booking page says he'll be in touch instead of offering to cancel (`cancelBooking` turns it away, so nobody cancels a trip he closed for the policy's no refund), with no Where to meet, waiver callout or calendar; put back by an earlier reopen whose full refund still stands (`refundGraceUntil`), it says the same and keeps Cancel with the grace line beside it. While a closure that cancels them or offers a new date is in its undo window, the booking and confirmation pages say he's just called it off and an email is minutes away (`closurePending`), with no Cancel or **Request a different date** (`requestReschedule` turns it away too). They aren't sent the confirmation again (Email the confirmation again, Reset their booking links), trip prep or day-of directions, or the "thanks for coming" email. Their booking page keeps saying so after the date, not that the tour has happened. On the admin booking page they stay movable and cancellable (a full refund) after the date too, and aren't marked completed or a no-show the usual way while the departure is closed (MCP's `mark_booking` refuses it and points to the admin page): if it goes ahead after all, Travis reopens it before it leaves, unless another trip the day closed has already left with people still booked on it (see Reopening below). Once it has left, a reopen would be wrong: a blackout comes down as a whole, so every trip it closed would count as having run (its guests emailed for a review, no Move or Cancel left). So then the admin booking page offers **It went out after all** instead, with a confirm that this trip ran though he closed it: **Mark as completed** (once it's back) or **They didn't show up** (`adminMarkBooking` with `ranAnyway`; not while a closure of the departure is in its undo window or going out). That booking alone then counts as a trip that ran, with its review request and photos (a completed booking isn't held back by a closed departure), and the day and every other trip on it stay closed. Close a day's past closed days have no Reopen. Once the date has passed, the dashboard lists them under **Closed, still booked** (the last 90 days of closed days), saying to open one that went out after all and mark it, and to move or cancel the rest, until each is moved, cancelled or marked. A day closed from MCP's `create_blackout` with guests on it counts the same, and the crew get the same "Closed" alert (step 6). While a closure that cancels them or offers a new date is in its undo window (or going out), the admin booking page says it's being called off instead, not that they were left booked, and Mark stays hidden; it says when an old-site payment is his to refund, and when there's no email on file, so he calls them. Someone whose checkout on one of those trips is paid after it closed, with no closure email on its way to them, is emailed that he'll be in touch instead of the confirmation (`stripeWebhook`).

**Reopening** a day (Reopen on Close a day, or MCP's `delete_blackout`) is refused while a trip it closed has already left with someone still booked on it: going ahead, not waiting on a new date, not marked completed or a no-show, and with no other closed day covering it (`assertReopenable` in `functions/src/lib/close-day.ts`). A blackout comes down as a whole, so reopening at 11 to run the 1:00 would have the 8:00 that didn't go count as a trip that ran (its guests emailed for a review, no Move or Cancel after the date), and once it has left it can't be closed again. The 409 names them and the trip; Close a day shows it where the result goes, and MCP's answer carries it word for word. Travis marks each one **It went out after all** if it did (the day stays closed meanwhile), or moves or cancels them, then reopens. An undo isn't refused: nobody was told the trip was off, so it may well have gone out, and while the closing is pending its bookings can't be marked as having gone out after all; refusing would leave the closing to cancel them or offer them a new date for a trip they took. So the undo goes ahead and names anyone still booked on a trip that left during the window (`alreadyLeft`, "It now counts as a trip that ran: check whether they went"), for Travis to move or cancel if it didn't go.

A reopen after the closure has gone out leaves cancelled bookings cancelled. Anyone it offered a new date who hasn't moved or taken the refund goes back on their original trip, as if it had never closed: `closure` comes off the booking, with a note, so `settleClosedBookings` doesn't refund them, the crew and the dashboard count them, and they get the day-before reminders if the day is reopened before those go out (by 3 PM the day before for the waiver reminder, 5 PM for the tour reminder). The offer's full refund still stands, since they were promised it in writing: the booking keeps the offer's deadline as `refundGraceUntil`, and until the end of that day (marina time) `cancelBooking` refunds a customer cancel in full instead of under the 72-hour policy. Their booking page and cancel dialog say so ("Travis reopened your trip; you can still cancel for a full refund until it leaves", or until the date, if that comes first), working it out the same way, so the dialog's `expectedRefundCents` matches. Put back by an undo, it's the deadline of the earlier offer they were sent; put back twice, the later deadline. Moving the booking takes it off: Travis moving it (`adminRescheduleBooking`), or the customer moving it after the trip is closed again (`moveClosedBooking`); the new trip is under the usual policy. They aren't emailed; `adminDeleteBlackout` returns them (`restored`) for Travis to tell. Not a trip that has already left, nor one another closed day still covers: those customers still choose (if that other one is still in its undo window and is undone, the undo puts them back, in the same transaction). An undo or reopen that leaves some or all of its trips under another closed day says so (`stillClosed`): Close a day and the banner then say the day is still closed by another closing of it, not open for booking again, and MCP's `delete_blackout` passes it on. Each booking changes in its own transaction, and only while it's still waiting (`restoreOfferedBookings` in `functions/src/lib/close-day.ts`), and is recorded on the closure as it goes (`restoredBookingIds`), so a reopen that fails partway and is tried again still lists everyone it put back. Anyone whose trip has left since (tried again after it left, or the next day) is listed apart (`alreadyLeft`): with the day open their trip counts as having run, and Travis never heard they were put back, so he's told to check whether they went; the crew's "Back on" leaves them out. If the crew were told those trips were off, they're told they're back on, once (`reopenCrewAlert` on the action): a push that replaces the closure's on their phones and an email, subject `[CRMF] Back on: Sat Oct 17, 8:00 (4 guests)`. That includes a day Travis left booked (the crew heard it was closed: the message covers the bookings still on those trips), an undo that puts back someone an earlier closure's alert named, and any undo or reopen after the 8 PM crew schedule listed those trips as closed or being called off, or after someone paid for one of them while it was closed (their new-booking email and push said so): the message then covers everyone going out on those trips. Anyone who paid for one of those trips while it was closed was sent no confirmation (or one saying Travis will be in touch), so the undo or reopen sends it now (`confirmationsSent` in the response, `confirmationsFailed` for him to resend from the booking page). A failure there is logged and doesn't stop the reopen; the reopen notice says whether the message reached all the crew (`crewTold`). Not a day left booked whose trips another closed day still covers: they aren't going out yet. Taking down a day closed from MCP (no closure of its own) whose "Closed" alert went out tells the crew everyone going out on its trips is back on, once (it goes once because the blackout comes down once). One that kept someone off their trip tells the crew the same way, claimed once on the earlier closure whose alert named them (`reopenCrewAlertsFor`), and so does one the 8 PM schedule or a new booking's alert told them about (it goes once because the blackout comes down once). The same goes for a day left booked that was reopened while one of those, or a closure later undone, still covered its trips: the crew hear its bookings are back on when that one comes down. Each "Back on" records whom it named (`bookingIds`), so nobody is named twice.

**Closures a reopen left behind.** Reopening a day used to only take its blackout down, so everyone the closure had offered a new date stayed "choosing" after the day reopened. Such a closure is stale (`isStaleClosure` in `functions/src/lib/close-day.ts`) when no blackout on the day covers the trip any more, it isn't being sent right now (its action isn't pending or finalizing), and the action has no `reopenedAt`: `restoreOfferedBookings` stamps that before the blackout comes down, so anyone a reopen here leaves choosing (their trip had already left) is choosing on purpose. A stale closure keeps what that reopen promised: it told Travis anyone he'd offered a new date still gets to choose, and their email said they'd be refunded in full if they didn't pick by the deadline. So they get the closure reminder, and `settleClosedBookings` refunds them at the deadline like anyone else choosing. The one difference is what the old version allowed: if they went out anyway, Travis can mark the trip completed or a no-show (`adminMarkBooking`, MCP's `mark_booking` too), which takes the closure off with a note on the booking, so nothing refunds them or offers them a new date afterwards. The booking page reads the day's blackouts and the closure's action to tell a stale closure apart; for one, it says the day was reopened and shows the mark buttons once the trip has left. Close a day warns when a reopen comes back without `restored`: the functions deployed are still the old ones.

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

Emails to Travis himself never alert, so an alert that bounces can't set off another. In admin, **Fix email and resend** on the booking saves the right address and sends again whatever bounced (confirmation, updated confirmation, "pick a new date" offer or its reminder, tomorrow's reminder, waiver reminder, "thanks for coming", trip photos). The trip photos email goes again with the gallery link as long as the booking went out and the gallery still has something in it; `sendTripPhotos` itself never sends a party a second one. A confirmation, or tomorrow's reminder, doesn't go again once the trip date has passed, or for a departure he closed, offered a new date or not (a blackout covers it): the "pick a new date" offer takes its place if there is one, and otherwise it says to call them. The new address is saved lowercased, as checkout saves it, and so is one changed in **Edit booking**. A waiver reminder goes again with who's still to sign as of then, unless everyone has signed since or the trip has happened. Weather-cancel emails to the crew are logged too, as `crew`, and never alert; so is each signer's copy of their signed waiver (`waiverCopy`), which goes to the address they typed when signing, not the booking's. A cancellation, "we got your request" note or "your trip is closed" note (it said Travis would be in touch) isn't sent again; the page says to call them.

Changing the address in **Edit booking** instead clears every alert marker on the booking (delay alerts included), so trouble with the new address alerts Travis again, but sends nothing. The "Email bounced" flag stays up: use **Fix email and resend** to send again what bounced.

An email that didn't bounce but reached the wrong person still carries working links to the booking. Fix the address in **Edit booking**, then **Reset their booking links** (under the customer's details): the old links stop working, waiver links they forwarded included, and the new ones go to the right address (`adminResetBookingLinks`). For a finished trip that's the photos email, if one went; the feedback link in "thanks for coming" needs **Send "thanks for coming" email** again (or a call).

## Admin notifications

Travis (or any admin) gets a push notification on each phone or computer he turns them on for, under Admin → **Settings** → **Notifications on this device** (the dashboard nudges until they're on). Tapping one opens the page to deal with it:

| Push | Opens |
|---|---|
| New booking (paid; not old-site imports). "On a trip you closed:" first when it was paid for after Travis closed its departure, as the crew's push says | the booking |
| Customer cancelled from their booking page, with what that cancellation refunded (`cancelRefundCents`; not refunds Travis gave before) | the booking |
| "Took the refund": a customer chose the full refund after Travis closed their trip (not the automatic one when the choosing deadline passes), with what went back and any old-site money to refund by hand | the booking |
| Email bounced (whenever the bounce alert email goes, see [Email log and bounce alerts](#email-log-and-bounce-alerts)) | the booking |
| Contact-form message (not ones over the hourly limit) | Messages |
| Reschedule request | Reschedules |
| Private feedback after a trip | the booking, which shows the whole message under **Private feedback** |
| Review requests going out, at 6 PM: tonight's, or tomorrow morning's on a day whose only trip is back after 7:00 (a sunset cruise) | Review requests |

- **iPhone:** notifications only work from a home-screen app. In Safari, open any admin page → Share → **Add to Home Screen** (it installs *Manatee Admin*, `src/app/admin.webmanifest/route.ts`, which opens on the dashboard), open it from the home screen, sign in, then turn notifications on in Settings. An admin page added to the home screen before this existed opens the public site instead; delete it and add it again.
- **How:** `public/admin-sw.js` (scope `/admin`) shows the pushes. Subscriptions are saved per device by `/api/admin/push` in `adminPushSubscriptions` (server-only) with the admin's email, and sent by `functions/src/adminNotifications.ts` with the same VAPID keys as the crew app. Signing out of admin turns that device's notifications off. Only endpoints on the browsers' own push services (Google, Apple, Mozilla, Microsoft) are saved (`src/lib/push-endpoint.ts`), and the functions check each saved one again before sending, crew phones included, deleting any that fail. A device saved by someone no longer in `ADMIN_EMAIL` / `OTHER_ADMIN_EMAILS` is deleted at the next push instead of sent to, since they can't reach Settings to turn it off. A push that replaces one with the same tag (a booking's "Cancelled" after its "New booking") still buzzes. The emails Travis already gets still go.

## Crew app

Admin → **Crew** is the crew list: Travis (captain) and the mates, each with a role, email, phone (stored for a future text channel; nothing is texted yet) and a crew-emails switch. Everyone with an email and crew emails on gets the `[CRMF]` crew emails (see [Automated messages](#automated-messages-scheduled-americanew_york)). On a fresh install, one tap adds Travis, Lacy, Faith and Megan; the mates' emails are added later.

Anyone with an email can also get a password for the crew app at **`/crew`**, separate from admin: confirmed upcoming tours (time, tour, headcount, and the names of guests still to sign a waiver; no booker names or contact details), with any Travis called off still listed and marked cancelled, a phone notification whenever a tour is booked, moved to another date or time (old-site bookings too, though not the import script's re-sync), or called off, and upload links for each trip's photos. They can't change anything else.

- **App passwords:** Admin → **Crew** → **App password**. The page makes up a random password (`k7m4-xq9p-2wht` style) and gives Travis a message with the link, email and password to text them. Passwords are stored as scrypt hashes, so they can't be shown again, only reset. A reset, removal, or taking away their email signs that person out on every phone and stops their calendar link.
- **Installing:** on iPhone, open `/crew` in Safari → Share → **Add to Home Screen**, then open *Manatee Crew* from the home screen and sign in there. iOS only allows web notifications from a home-screen app (iOS 16.4+), and it keeps that app's sign-in separate from Safari's. On Android, Chrome works as-is; adding to the home screen is optional.
- **Notifications:** after signing in, tap **Turn on notifications**, then **Send a test**. Sign-in sessions last a year; 10 wrong passwords lock an account for 15 minutes. Tries at an address that isn't on the crew are counted and locked the same way (`crewSignInAttempts`, by the address's SHA-256), so a wrong sign-in takes as long whether or not the email is a crew member's. Those docs carry `expiresAt`, a day after the last try, and a TTL policy in `firestore.indexes.json` (deployed with the indexes) has Firestore delete them, so addresses typed at random don't pile up.
- **Running a trip solo:** when a trip is too small to pay crew for, Travis switches its **Crew** off under Admin → Crew → **Upcoming trips** (or on today's and tomorrow's cards on the dashboard). The crew app keeps the trip on the schedule, faded, with "No crew needed", the crew calendar feed's event says the same (with no reminder, and it doesn't block their time), and every crew phone gets a notification. Switching it back on sends another. The switch is per departure (date and time), so it stays off if more guests book that trip; their booking notification and `[CRMF]` new-booking email say "No crew needed". Upcoming trips counts the guests going out the way the crew app does: anyone choosing a new date after Travis closed their trip isn't on it, and a trip with only them on it isn't listed (it isn't going out). A trip he closed is marked as on the dashboard: **Closed, still booked**, or **Closing** with no switch while the undo window is open.

### Crew calendar

Admin → **Crew** → **Send calendar link** emails that crew member a link that puts every booked departure in their phone's calendar. iPhone: tap the `webcal://` button in the email, then Subscribe. Google Calendar: Other calendars → + → From URL, paste the `https://` link. Crew can also get or replace their own link from the crew app (**Trips in your calendar**).

- **Feed:** `/api/crew-calendar/<token>` (`src/app/api/crew-calendar/[token]/route.ts`, built by `src/lib/crew-calendar/`). The last 14 days and the next 120, one event per departure with guests: `8:00 shared · 6 guests`, `3:30 private · 4 guests`, `7:00 whole-day charter · 5 guests`. A departure Travis closed that had bookings stays in the calendar as `CANCELLED (weather): 8:00 shared` with `STATUS:CANCELLED`. One he closed and left them booked on reads `CLOSED (weather): 8:00 shared · 2 guests`, and one he's closing right now (undo window open) `BEING CALLED OFF (weather): …`, with the 8 PM schedule's note, unless he's marked it completed. Marina time with an `America/New_York` VTIMEZONE, Pete's Pier as the location, a 60-minute reminder, and a link to the crew app (sign-in needed).
- **Privacy:** counts only. No guest names, phones or emails, because Apple and Google copy subscribed calendars to their servers. The route only reads the booking fields it counts, and only bookings that can count: no no-shows, and no checkouts the site let go unpaid (`FEED_STATUSES` and `FEED_CANCELLED_BY` in `feed.ts`, a composite index in `firestore.indexes.json`).
- **Links:** a random 32-byte token. Firestore keeps only its SHA-256 (`crewCalendarTokens/{hash}`, and the live hash on `crewCalendars/{crewId}`), all server-only. Sending a new link, resetting the password, clearing their email or removing the crew member kills the old one; a dead link gets a plain 404. The token is in the URL, so it also shows up in App Hosting's request logs: keep access to those logs to Travis and Danny. The feed is sent `Cache-Control: private, no-cache`, so no shared cache keeps a copy.
- **Updates:** each event has a stable UID (`<date>_<slot>@crystalrivermanateefun.com`), and its SEQUENCE goes up whenever its content changes (`crewCalendarDepartures/{date_slot}` keeps a fingerprint per departure). The feed asks for a refresh every hour, but that's a hint: iPhone checks fairly often, Google Calendar can lag by hours. Every link gets the same feed, so each server instance builds it at most every 10 minutes and hands that out (the link is still checked on every fetch): a change can take that long to show. Push notifications and `[CRMF]` emails stay the source for last-minute changes; the email says so.

### Trip photos

Guests get their trip's photos without Travis doing anything:

1. **Crew upload.** Every departure (date + time slot) has a no-sign-in upload link, `/upload/<token>`. It's in the 8 PM crew email for tomorrow's trips, in the crew app under **Trip photos** (not for a departure Travis closed and left them booked on: it didn't run, as the 8 PM email says), and on the admin booking page. On a phone it opens the camera roll; photos and videos go straight to Firebase Storage under `trips/<date>_<slot>/`, with upload progress. The link stops taking uploads 7 days after the trip. `storage.rules` checks the token against `tripUploadTokens/{token}` on every upload, and takes only a photo or video type with a matching extension (JPEG, PNG, HEIC/HEIF, GoPro GPR, DNG, WebP, GIF, AVIF, MP4, MOV, M4V, 3GP, WebM) and no backslash in the name; the uploader adds the extension when a phone hands over a file without one. Names are cleaned again for the gallery and the zip.
2. **Recorded and copied.** `onTripPhotoUploaded` (a Storage trigger) records each file in `tripPhotos/{tripId}/files` for the gallery (a video, or any file over 25 MB, is also set to download under its name, `Content-Disposition: attachment`, and marked `attachment`), then copies it into Google Drive under **Manatee Fun Trip Photos**, one folder per departure, for Grok Bot and the blog. If Drive isn't connected or a copy fails, it's logged and the gallery still works; `retryDriveCopies` tries again hourly, however old the trip (including uploads from before Drive was connected). It reads only the files not yet in Drive and not given up on, up to 100 a run, with one collection-group query (an index in `firestore.indexes.json`). Each copy holds its file for 15 minutes (`drive.leaseUntil`), so the trigger and the retry never copy one file twice, and a photo deleted mid-copy has its Drive copy removed when the copy lands. So does a copy whose landing couldn't be recorded, before the retry makes another, unless the file can't be read back to tell (it may be the photo's only copy, so it stays). A copy that couldn't be deleted is listed on the trip (`withdrawnDriveIds`), which keeps it off the blog. A copy that fails counts as a try, and after 5 the file is left out of Drive (Trip photos says "gave up"). A copy Google won't sign the site in for (access removed, token expired) doesn't count, and waits until Drive is connected again. Nor does one Drive refuses for the whole account (it's full, or the Drive API is off): it waits too, and Settings says what's wrong (`lastRefusal` on `driveConfig/oauth`) until a copy lands again.
3. **Admin review.** Admin → **Trip photos** lists recent departures with guests on the boat (old-site deposits count; a departure Travis called off doesn't); each one shows its uploads, with delete (which also removes the Drive copy). The same rule decides the Trip photos card on the booking page. If Drive isn't connected or doesn't take that delete, the page says the copy is still in the trip's Drive folder, for Travis to delete there (nothing tries again; the audit log records it as `driveCopyLeft`). Either way the copy's Drive id goes on the trip's `withdrawnDriveIds`, in the same transaction as the delete, so no new blog post uses it. A post that already has the photo keeps its own copy: the page names those posts (live, or drafts waiting for his OK), to take off the website or decline in Admin → Blog (`blogPosts` in the audit log).
4. **Guest gallery.** `/my-booking/<id>/photos?k=<key>`: the departure's photos and videos with a download button each and **Download all** (a zip of the photos). Videos and anything over 25 MB aren't in the zip, and the page says to download them one at a time: App Hosting runs on Cloud Run, which won't send a response over 32 MiB that states its length, and stops a request at 5 minutes: too soon for a zip of GoPro clips on hotel Wi-Fi. Those files download straight from Storage (their `attachment` download URL), which is also cheaper than App Hosting's egress; ones recorded before that was set still go through `/photos/file/<id>`, streamed without a length. A file the gallery can't show as a photo (HEIC, raw GPR or DNG, or one over 25 MB) is a tile with its name and a download button. Every party on a shared tour sees the same gallery. The photos email's link carries its own key, a hash of the booking's token (`functions/src/lib/gallery-link.ts`, the same in `src/lib/gallery-link.ts`), so the booker can forward it to their party: it opens the photos and nothing else. The booking page links it with `?t=<accessToken>` instead, and only then does it link back to the booking. **Reset their booking links** cuts off both.
5. **Guest email.** `sendTripPhotos` emails each party on a departure with photos at 9:00 AM ET the day after the trip (not one Travis closed and left them booked on, unless he's marked it completed). Photos that arrive later go out once uploads have stopped for 60 minutes, only between 8 AM and 8 PM ET, up to 7 days after the trip. Only trips uploaded through the links count: a `tripPhotos` doc left by the old Drive-only uploader has a count but no files (no `uploadToken`), so it sends nothing. Marker: `photosSentAt`. To send it again (it bounced, or went to the wrong person): **Fix email and resend**, or **Reset their booking links**.

The blog picks photos from these folders too ([Blog (grokbot)](#blog-grokbot)), but never one deleted from Trip photos whose Drive copy stayed: it leaves out exactly the trips' `withdrawnDriveIds`, so uploads from the old Drive-only uploader and photos Travis puts in a trip folder himself are still offered. A post that already has the photo keeps its own copy until Travis takes the post down. After that it can't go back up, and a draft that has it can't be approved: Travis declines it and Grokbot writes another (`hasWithdrawnPhoto` in `src/lib/blog-publish.ts`).

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
   6. The site copies that connection into `driveConfig/oauth` (server-only) the first time it's needed (an upload page opening, or Admin → Settings), and the Cloud Functions that copy photos read it from there. After a rollout with a new `GOOGLE_DRIVE_REFRESH_TOKEN`, it copies the new token over one the script made before; a connection made with the Settings button, or a disconnect, is left as it is. Admin → Settings → **Google Drive for trip photos** shows the connected account and can disconnect.
   7. After the first copy creates **Manatee Fun Trip Photos** in that Drive, share the folder with whoever else needs it (Travis, grokbot's account). Don't make the folder by hand: with `drive.file` the site can't see folders it didn't create.

   It's connected for `crmf-99aad`. To reconnect (Settings shows a sign-in error), run step 4 again and re-set `GOOGLE_DRIVE_REFRESH_TOKEN`. Then start a new App Hosting rollout (or push to `main`) and wait until it's `LIVE`: the site only sees a new secret version after a rollout. Only then delete `driveConfig/oauth` in the Firestore console, and reload Admin → Settings so the site copies the new token. Deleted any earlier, a server still on the old rollout can copy the old, revoked token back in. Settings says the same when there's a sign-in error. The **Connect Google Drive** button in Settings needs a *Web application* client with `https://<host>/api/admin/google-drive/callback` listed as a redirect URI (Google sends the desktop client above only back to the computer running the script), in its own env vars: `GOOGLE_DRIVE_WEB_CLIENT_ID` and, as an App Hosting secret, `GOOGLE_DRIVE_WEB_CLIENT_SECRET`, added to `apphosting.yaml`. Without them Settings shows no button, only the script steps.

3. **Storage rules.** `storage.rules` reads Firestore (`firestore.get`) to check upload tokens. The first `firebase deploy --only storage` asks to let Storage read Firestore; say yes.

4. **Deploy** rules, indexes, storage and functions (`firebase deploy --only firestore:rules,firestore:indexes,storage,functions`), then push to `main`.

## MCP server

The site is also an [MCP](https://modelcontextprotocol.io) server at **`/api/mcp`**, so Claude (or any MCP client) can check the calendar and handle routine admin work. It runs inside the Next.js app on App Hosting. It reads Firestore directly and makes changes through the same admin Cloud Functions as the admin pages, so it gets the same validation, capacity checks, customer emails and audit log. It speaks Streamable HTTP, stateless, with JSON responses (`POST` only).

| Read-only | Changes |
|---|---|
| `get_availability`: open seats per departure, up to 62 days | `add_booking_note`: appends to the internal notes |
| `list_tours`: schedule, standard prices, seasonal rates, price on a date | `mark_booking`: completed / no-show |
| `list_bookings`: by date range, customer email or search text; a booking on a departure Travis closed says so (`closedDeparture`) | `resend_confirmation_email` |
| `get_booking`: guests, contacts, payments, notes, reschedule requests, admin link; on a closed departure, whether the customer is choosing, it's being called off, or he left them booked, as its admin page says, and what he can do | `edit_booking`: party size, guest list (names, ages, wetsuit sizes; one he doesn't stock is refused with the list of those he does), contact details except the email address |
| `get_day_schedule`: each departure's seats, manifest, and whether it has crew; for a closed departure with people on it, whether it's going out (`off`, as the dashboard shows it); whether the boat has actually left (`left`), not just passed the online cutoff (`departed`) | `reschedule_booking`: capacity-checked, emails a confirmed customer by default and says whether it did |
| `list_blackouts` | `create_blackout` / `delete_blackout`: never cancels bookings; lists the ones still on a closed departure, flagging anyone still in checkout (`stillPaying`: cancel it in admin, or a payment confirms it there), and sends the crew the "Closed" alert a day left booked sends (`crewTold`). Won't close a past date or a departure that has already left, nor reopen a day while a trip it closed has left with someone still booked on it |
| `list_contact_messages` | `update_tour`: name, description, included, active, price (dollars) |
| `list_reschedule_requests` | `upsert_rate_season` / `delete_rate_season` |
| | `update_contact_message` / `update_reschedule_request` |
| | `set_trip_crew`: take the crew off a trip, or put them back on; notifies the crew |

It also has the blog tools (`get_blog_brief`, `list_blog_photos`, `view_blog_photo`, `check_blog_post`, `submit_blog_post`). Grokbot reaches those, and only those, at **`/api/mcp/blog`** with a key worked out from `MCP_TOKEN`; see [Blog (grokbot)](#blog-grokbot).

**What it can't do:** refunds, cancellations, blackouts that cancel bookings, changing a customer's email address (their booking links go to it) or resetting those links, site settings, photos, reviews or crew accounts. Answers about a booking include its admin link for those, on the address the connector uses (the hosted.app one until the domain moves). Customer access tokens are never returned.

### Setup

It's switched on for `crmf-99aad`. These are the steps it took, for a new project or a rebuild:

1. Make a token (at least 32 characters) and store it as one Secret Manager secret, used by both Cloud Functions and App Hosting:

   ```bash
   openssl rand -hex 32 | tr -d '\n' > mcp-token.local.txt
   firebase functions:secrets:set MCP_TOKEN --data-file mcp-token.local.txt
   firebase apphosting:secrets:grantaccess MCP_TOKEN --backend <backend-id>
   ```

   `tr` drops the newline `openssl` ends its output with: the CLI stores the file exactly as it is, and the site and the functions compare the token exactly, so a stored newline would turn away the 64 characters a connector sends. Keep the token in your password manager, then delete the file.

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

The token can do everything in the table above, so keep it private. To replace it:

1. Make a new one and set it with the same two commands as in step 1 (`openssl … | tr -d '\n'`, then `functions:secrets:set`; access is already granted). The CLI then offers to redeploy the functions that use it and destroy the old version of the secret, with **Yes** as the default: answer **No**. The CLI checks only the functions before destroying it, but the live App Hosting rollout keeps the version it started with until the next rollout, and destroyed, that version could leave the site unable to start a new server.
2. Run `firebase deploy --only functions`, then start a new App Hosting rollout (`firebase apphosting:rollouts:create default --git-branch main`, or push to `main`) and wait until it's `LIVE`. In between, the change tools fail with "refused the MCP token".
3. Update each connector, and Grokbot's (copy the new **Grokbot connector address** from Admin → Blog into Grok: its key is worked out from the token).

The old version stays in Secret Manager, unused; destroy it there later if you like.

## Blog (grokbot)

Every other week Post Bot (a Grok automation, separate from the SEO bot) writes a post for `/news` with photos from Travis's Google Drive, through the blog tools at `/api/mcp/blog`. A draft has to pass a Yoast-style SEO and readability check (`src/lib/seo-check.ts`): keyphrase placement and density, title and meta description length, internal and outbound links (each one checked), images and alt text, text length, subheadings, sentence and paragraph length, Flesch reading ease, passive voice and transition words, plus a few of our own. Then Travis gets the whole post by email, and it goes on the site only when he approves it on the review page (`/blog-review/<slug>`, from the email, or **Admin → Blog**). If he turns it down, his note goes back to Post Bot. A weekly automation posts every other week (`src/lib/blog-rules.ts`).

Posts live in `newsPosts/{slug}` and their photos in Storage under `public/news/<slug>/`. The News pages merge them with the Markdown posts in `content/news`. **Setup, the automation prompt and the full list of checks: [docs/grokbot-blog.md](docs/grokbot-blog.md).**

## Deploying

### One-time setup

1. **Create the Firebase project** in the console (suggested: `crystal-river-manatee-fun`).
2. **Upgrade to the Blaze plan** — Cloud Functions and App Hosting both require it. In season, expect roughly $30–40 a month at first, and more as trip media piles up: Resend Pro, $20 (not Firebase, but needed, see [Wire up Resend](#wire-up-resend)); Firestore, about $3–9 (150–500k reads a day); Cloud Scheduler, about $1 (15 jobs, 3 free); App Hosting egress past its free 10 GiB a month, at $0.20/GiB, mostly guests downloading trip photos (a few dollars); and Cloud Storage for trip photos and videos, which are kept and grow every season: about $2–3 a month more for each year of photos, $10–25 more for each year with a 4K GoPro clip on every trip, plus $0.12/GB for videos downloaded from Storage. Cloud Functions mostly stay within the free tier.
3. **Enable services:** Authentication (Google provider), Firestore (production mode), Cloud Storage, Cloud Functions, App Hosting.
4. **Authorize the admin Google account.** In Authentication, ensure `travisurbin1@gmail.com` has signed in (you can do this from the local dev app once you've populated `.env.local`). The Firestore rules and `NEXT_PUBLIC_ADMIN_EMAIL` are already wired to this address. To let another Google account into admin (it won't get Travis's booking emails), add it in four places, then roll out the site and run `firebase deploy --only functions,firestore:rules,firestore:indexes,storage`: `OTHER_ADMIN_EMAILS` in `apphosting.yaml` and in `functions/.env.crmf-99aad` (comma-separated), and the list in `isAdmin()` in `firestore.rules` and in `storage.rules`.
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
- `APP_BASE_URL`: the `*.hosted.app` URL (`https://default--crmf-99aad.us-east4.hosted.app`) until the domain moves, then `https://crystalrivermanateefun.com` (see the [launch checklist](#launch-checklist)). Stripe sends payers back to it, every link in the emails uses it, and it's where the admin functions [refresh the site](#refreshing-the-site)
- `VAPID_PRIVATE_KEY` (crew push notifications — see [Crew app setup](#crew-app-setup))
- `MCP_TOKEN` (the MCP endpoint, also read by App Hosting — see [MCP server](#mcp-server))

### Deploy infra

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```

**Deploying from GitHub (phone-friendly).** Actions → **Deploy** → **Run workflow** deploys functions (or the rules and indexes) from `main`. It only runs on `main`, so a release whose functions must go out before its merge (like [this one](#rolling-out-this-release)) deploys them from the branch with the CLI instead; later releases can use the workflow. It runs the functions tests first and deletes functions that are no longer in the code. It does that with `--force`, since it can't answer the CLI's prompts, and when the indexes are picked `--force` also deletes, without asking, every index and field override live in Firestore that isn't in `firestore.indexes.json`, TTL policies included (those on `rateLimits` and `crewSignInAttempts` are field overrides). So keep every index and TTL policy in that file, never only in the console. A CLI deploy of the indexes lists any it finds live and not in the file, and asks before deleting them (the default is No): add those to the file before the workflow next deploys the indexes. One-time setup: in the Google Cloud console for `crmf-99aad`, **IAM & Admin → Service accounts → Create service account** (`github-deploy`), give it the **Editor** and **Secret Manager Admin** roles, then **Keys → Add key → JSON**. Paste the whole file into GitHub → Settings → Secrets and variables → Actions → New repository secret named `FIREBASE_SERVICE_ACCOUNT`, and delete the downloaded file. Storage rules need the one-time "let Storage read Firestore" approval from the CLI (see [Crew app setup](#crew-app-setup)) before the workflow can deploy them.

After functions are live, look up the deployed `stripeWebhook` URL:

```bash
firebase functions:list   # or check the Firebase console
```

It looks like `https://us-central1-<project>.cloudfunctions.net/stripeWebhook`.

### Storage lifecycle for trip photos (recommended)

Every photo and video the crew upload stays in Storage under `trips/` for good: nothing deletes them but Trip photos, one at a time, and Travis's Drive has a copy of each anyway. That's roughly 0.1 TB a year on photos alone, up to about 1 TB with a GoPro clip a trip, each year on top of the last. Guests open a gallery in the first weeks after their trip, so move files older than 60 days to Coldline, which costs about a fifth as much to keep:

```bash
cat > storage-lifecycle.json <<'EOF'
{
  "lifecycle": {
    "rule": [
      {
        "action": { "type": "SetStorageClass", "storageClass": "COLDLINE" },
        "condition": { "age": 60, "matchesPrefix": ["trips/"], "matchesStorageClass": ["STANDARD"] }
      }
    ]
  }
}
EOF
gcloud storage buckets describe gs://crmf-99aad.firebasestorage.app --format="default(lifecycle_config)"
gcloud storage buckets update gs://crmf-99aad.firebasestorage.app --lifecycle-file=storage-lifecycle.json
```

- It only changes the storage class. Nothing is deleted, the gallery's links (download tokens) and downloads keep working, and nothing outside `trips/` is touched (site and blog photos, waivers).
- Coldline charges about $0.02/GB to read a file back (a guest downloading an old gallery, a thumbnail the CDN has dropped, the hourly retry copying an old file to Drive), and bills 90 days of storage for a file deleted sooner after the move (a photo Travis deletes from Trip photos). For galleries nobody opens any more, both are pennies.
- `--lifecycle-file` replaces the bucket's whole lifecycle configuration. If `describe` shows rules already, add this one to them. `gcloud storage buckets update gs://crmf-99aad.firebasestorage.app --clear-lifecycle` takes it off again.

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

This is the test-mode endpoint, for the test key (`sk_test_…` in `STRIPE_SECRET_KEY`). Stripe keeps live mode's webhook endpoints, and their signing secrets, apart from test mode's, so live mode needs its own endpoint at launch (see the [launch checklist](#launch-checklist)). The keys are Cloud Functions secrets only: the site reads no Stripe key, and Checkout runs on Stripe's own page.

### Wire up Resend

**Plan.** Resend's free plan allows 100 emails a day and 3,000 a month, and every recipient counts, a bcc too. Each paid booking sends about 13–15: the confirmation and Travis's copy, the crew's "booked" alert (one per crew member), each signer's waiver copy, trip prep, directions, the day-before reminder, the photos email, the review request and Travis's copy; on top of those, the crew's 8 PM schedule and Travis's review list every day. That passes the free plan at 7–8 bookings a day. Over it, Resend refuses every send (`daily_quota_exceeded`), which isn't tried again the way its rate limit is: confirmations wait for Stripe's retries, and day-of directions and crew alerts can miss their window. Upgrade to Pro ($20 a month for 50,000 emails, no daily limit) before launch.

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

The site deploys on every push to `main`, but Cloud Functions, the Firestore and Storage rules, and the indexes only when someone runs `firebase deploy`. When a change touches both (a function that takes a new field, a page that expects a new response), deploy functions and rules first, from the head of the branch about to be merged, then merge it, then reload any admin tabs left open. Keep new functions answering what the live pages send, and the few minutes before the new site is live are harmless; the other way round, a new page calls a function that doesn't exist yet or answers the old way:

```bash
# on the branch, before merging
firebase deploy --only functions,firestore:rules,firestore:indexes,storage
```

### Rolling out this release

This release changes functions and pages together, and the old functions can't serve the new pages: reopening a closed day would promise bookings back that the old function doesn't put back, new buttons call functions that don't exist yet, and a customer's cancel isn't checked against the refund their dialog showed. The new functions do serve the old pages, apart from the few things step 1 says to leave alone until the site is live. So, in this order:

1. In the evening, after 8 PM ET, from the branch head, before merging: `firebase deploy --only functions,firestore:rules,firestore:indexes` (the storage rules wait for step 4). If it refuses to change `onWaiverSigned`'s retry setting in place, delete that function (`firebase functions:delete onWaiverSigned --region us-central1`) and deploy again. A waiver signed in between is saved, but its signer isn't emailed their copy. If production still has the old 7:00 AM `sendPostTourFollowups`, the deploy lists it for deletion and asks to proceed: answer **Yes** (the default is No, and a non-interactive deploy stops there), or delete it first with `firebase functions:delete sendPostTourFollowups --region us-central1`. `sendReviewRequests` replaces it; left running, the old job knows nothing of **Hold** and would send the review email the next morning to a guest Travis held to call first. The new indexes (for `settleClosedBookings`, which runs at 6 AM, Admin → Bookings' Past and Cancelled tabs, the crew calendar feed, and `retryDriveCopies`) take a few minutes to build. From this deploy on, checkout also adds the 6% Florida sales tax, which the old booking page leaves out of its total: anyone booking before step 2 is live sees the tax for the first time on Stripe's page, one more reason to do steps 1 and 2 back to back, in the evening.

   Then go straight on to step 2, and until step 3 is done leave two things alone:
   - **Photos emails.** From this deploy on, the photos email links the gallery with its own key (`?k=`), which the old gallery page doesn't open: the guest would be told the link from their email doesn't work, and it isn't sent again. `sendTripPhotos` sends nothing between 8 PM and 8 AM ET, hence the evening: have the site `LIVE` before 8 AM. Don't use **Fix email and resend** on a photos email until it is.
   - **Closing a day.** Don't close, undo or reopen a day (a close may need undoing). When a closure is undone or reopened, the new functions put its customers back on their trip without emailing them, for Travis to call, and the old **Close a day** page neither says so nor lists them.
2. Merge to `main`. App Hosting deploys the site; wait until the rollout is `LIVE`.
3. Reload any admin tabs left open, Travis's phone included, so none keeps running the old pages. Ask the crew to reload the crew app and any upload page they have open too.
4. Deploy the storage rules: `firebase deploy --only storage`. They take a photo or video only with a matching extension in its name, which the new uploader adds when a phone hands over a file without one. The old uploader sent each file under its own name (an Android pick called `image`, say), so an upload page not reloaded in step 3 has those refused, on every retry.
5. Fill in the money owed back on old-site bookings cancelled before this release. Until now that was only in the booking's private note, so Reports and the dashboard count it as kept, there's no **Refunded by hand** button, and the customer's page says nothing was refunded. The same run makes private the reasons Travis typed when he cancelled without emailing the customer. The dry run lists each booking and amount; check them, then write them. Safe to run again.

   ```bash
   npm run backfill:manual-refunds
   npm run backfill:manual-refunds -- --apply
   ```

   The backfill can't tell which of that money Travis has already paid back by hand (most of it, likely, long ago). So `--apply` ends by listing every booking still owed back by hand, with its admin link: open each one he's already paid back and tap **Refunded by hand**. Until he does, the customer's booking page says he'll refund them and the admin lists the money as owed. The links are on the `*.hosted.app` address, because until the domain moves `crystalrivermanateefun.com` is still the WordPress site. Once it has moved, add `--base https://crystalrivermanateefun.com` for links on the domain.
6. Put back in the queue the trip photos the old functions gave up copying to Drive while Google wouldn't sign the site in (Settings showed a sign-in error) or Drive was full. The old functions counted each of those failures as one of the file's 5 tries, so within a few hours Trip photos said "Drive copy failed (gave up)" and the hourly retry stopped trying; the new ones wait instead. The dry run says how many there are, per trip (most likely none). `--apply` sets their tries back to 0, and `retryDriveCopies` copies them within the hour once Drive takes files. A file that failed for a reason of its own stays given up on. Run it once step 1's indexes have built. Safe to run again.

   ```bash
   npm run requeue:drive-copies
   npm run requeue:drive-copies -- --apply
   ```

What else changes with it:

- The 3 PM waiver reminder stops until `SEND_TOUR_REMINDERS=true` (see the [launch checklist](#launch-checklist)). It used to go out regardless; now it's off with the tour reminder. **Send waiver reminder** on a booking still works.
- Old-site "pending payment" orders imported with nothing paid are still `pending-payment` until the launch re-sync (`npm run import:legacy -- --file <newer export> --update-existing`) files them as cancelled. Until then they count as trips going ahead, like a reservation with a deposit: in the crew's head counts, and markable completed or a no-show.

### Custom domain

In App Hosting → your backend → Domains, add `crystalrivermanateefun.com`. Update DNS at the registrar with the records Firebase provides. SSL provisions automatically (usually within 30 minutes).

#### Staging stays out of Google

Every response served from a host other than `crystalrivermanateefun.com` (the `*.hosted.app` URL, `localhost`) carries `X-Robots-Tag: noindex, nofollow`. Its `/robots.txt` allows crawling and lists no sitemap: Google only sees a noindex on a page it may fetch, and a `Disallow` would leave any staging URL it already has stuck in its index as "blocked by robots.txt". That's done in `src/proxy.ts` and `src/app/robots.ts`, so nothing needs switching on. A request that names the real domain anywhere (in `Host`, or in any `X-Forwarded-Host` entry) is never marked noindex, so a visitor's made-up `X-Forwarded-Host` can't get a noindex page into the CDN's cache for everyone (`namesProductionHost` in `src/lib/host.ts`; there's a check for it in the [launch checklist](#launch-checklist)).

#### `CANONICAL_HOST_REDIRECT`

Declared in `apphosting.yaml`, default `"false"`. When set to `"true"`, `src/proxy.ts` sends a 301 from `www.crystalrivermanateefun.com` and the `*.hosted.app` URL to the same path and query on `https://crystalrivermanateefun.com`. It leaves these alone:

- `/api/*`, `/admin` and `/admin/*`: the admin session cookie belongs to the host it was set on
- `/blog-review/*`: the same cookie lets Travis open a draft from Admin → Blog without the email's link
- `/crew`, `/crew/*`, `/crew-sw.js`, `/admin-sw.js` and `/admin.webmanifest`: the crew's and Travis's home-screen apps, their sign-ins and their push notifications stay on the host they were installed from (a service worker script can't be redirected), so nobody has to reinstall
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
- [ ] Stripe account approved for live mode (the switch itself is under **Launch** below)
- [ ] Resend domain verification + `From:` address
- [ ] Resend on Pro ($20 a month) or bigger: the free plan's 100 emails a day runs out at 7–8 bookings a day (see [Wire up Resend](#wire-up-resend))
- [ ] Resend webhook for bounce alerts + `RESEND_WEBHOOK_SECRET` (see [Wire up Resend](#wire-up-resend))
- [ ] Travis signed in at `/admin/login` at least once so Auth has his profile
- [ ] Composite indexes deployed (in the `firebase deploy` command above)
- [ ] First `npm run seed` against the live project
- [ ] Old-site bookings imported with `npm run import:legacy`, then re-synced from a fresh export with `--update-existing` on launch day, after booking on the old site is turned off (see **Launch** below)
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

In this order. When `firebase functions:secrets:set` offers to redeploy the functions and destroy the old version of the secret (the default is Yes), answer **No** and deploy as the step says.

- [ ] **Clear out the test bookings.** While Stripe is still in test mode, cancel every test booking still to come from Admin → Bookings → Upcoming (a full refund), test checkouts nobody paid for included (cancelling one expires it at Stripe), and start no more. Left in, they hold seats on real departures, go on the crew's lists and into Reports, and get the guest emails; and once the live key is in, cancelling one fails, since a live key can't refund or expire anything made in test mode. A test trip already past can't be cancelled: refund it in full in Stripe's test-mode dashboard, which the webhook records on the booking.
- [ ] **Switch Stripe to live.** In Stripe's live mode, add a webhook endpoint: the same `stripeWebhook` URL and the same six events as in [Wire up Stripe](#wire-up-stripe). Then run `firebase functions:secrets:set STRIPE_SECRET_KEY` (the live `sk_live_…` key) and `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET` (the live endpoint's `whsec_…`), and `firebase deploy --only functions` once, so both change together: a live key with the test endpoint's secret, or the other way round, leaves every payment unconfirmed and its seats held. Do it when no test checkout has been opened in the last 35 minutes: an open one's expiry is a test-mode event, which the live secret turns away. These are Cloud Functions secrets; the site reads no Stripe key.
- [ ] **Stop booking on the old site, then re-sync.** Turn off booking on the WordPress site (WooCommerce checkout or the booking form off, or maintenance mode), so nothing is booked there that the export misses. Make the same change on the old site to every old-site (`legacy-…`) booking cancelled or moved in the new admin (Admin → Bookings → Cancelled, and moves in Admin → Activity), or the re-sync puts it back. Then export the bookings CSV, run `npm run import:legacy -- --file <export> --update-existing --dry-run` and check each booking it says it would change against the new admin, then run it without `--dry-run`. Only then change DNS: once it points at App Hosting, `crystalrivermanateefun.com/wp-admin` is the new site, and the export can't be taken.
- [ ] Add the apex and `www` domains in App Hosting and update the A and TXT records. **Don't touch the MX records.**
- [ ] As soon as the domain serves the new site, confirm Google can index it: `curl -sI https://crystalrivermanateefun.com` shows **no** `X-Robots-Tag` header, and `/robots.txt` shows `Allow: /` and the sitemap. Every other host is noindexed on purpose (see [Staging stays out of Google](#staging-stays-out-of-google)), so if either check fails, App Hosting isn't passing the real hostname through. Fix that before going further.
- [ ] Then check a visitor can't get a noindex into the CDN's cache. Use an address nobody else asks for: the CDN caches `/faq` by its path and query, so on the bare `/faq` a copy someone else had cached would answer instead of the site and pass the check whatever the site does, and a check that fails would leave its noindex page cached there for everyone. Run `u="https://crystalrivermanateefun.com/faq?xfh-check=$(date +%s)"`, then `curl -sI -H 'X-Forwarded-Host: x.example' "$u"`, then a plain `curl -sI "$u"`. Neither should have an `X-Robots-Tag` header. If one does, App Hosting passes a visitor's `X-Forwarded-Host` through without the real host beside it, and `namesProductionHost` (`src/lib/host.ts`) needs another way to tell. Fix that before going further.
- [ ] Once `https://crystalrivermanateefun.com` serves the new site with a valid certificate (the `curl` checks above only answer once it has), run `firebase functions:secrets:set APP_BASE_URL` with `https://crystalrivermanateefun.com`, and deploy functions. Not before: Stripe sends payers back to it, and every link in the emails (booking pages, waivers, galleries, Travis's admin links) uses it, so they'd get a certificate error, or the old site where DNS is still cached.
- [ ] Once the old site's bookings are re-synced, set `SEND_TOUR_REMINDERS=true` in `functions/.env.crmf-99aad`, commit it and push it to `main`, and deploy functions. Every later release deploys from the branch head, so a change left only in one working copy is turned off again by the next deploy, with no warning. Until then both day-before emails, the tour reminder and the waiver reminder, stay off, so nobody who booked or cancelled on the old site gets one. (Travis's **Send waiver reminder** button still works.) Old-site bookings also get no trip prep, day-of directions or photo email until then; once it's on, every imported booking within 72 hours of its trip gets trip prep within the hour.
- [ ] Set `CANONICAL_HOST_REDIRECT` to `"true"` in `apphosting.yaml` once SSL is active on the domain, and roll out (see [`CANONICAL_HOST_REDIRECT`](#canonical_host_redirect)). Then make one real booking end to end, and refund it, to confirm checkout still works.
- [ ] After the first few real checkouts, open two bookings made from different places in the Firestore console and check their `checkoutIpHash` values differ. If every booking has the same one, the address `clientIp` (`functions/src/lib/checkout-limit.ts`) reads is a proxy's, not the visitor's, and the three-checkout limit is shared by everyone: fix `clientIp` before it turns customers away. The functions log helps: each checkout logs `Checkout visitor address` with how many `X-Forwarded-For` entries came in (`forwardedForEntries`) and which one counted (`entryUsed`, from 0 at the left), never the address. With nothing of ours in front of the functions that's normally 1 entry and entry 0. `entryUsed: null` on every checkout means no address could be used, so nobody is limited at all.
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
