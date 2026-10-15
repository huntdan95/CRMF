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
├── content/news/              # News posts (Markdown), served at /news/<slug>
├── functions/                 # Cloud Functions workspace
│   └── src/                   # 12 endpoints (public + admin)
├── scripts/seed.ts            # Firestore tour seeder
├── scripts/check-redirects.ts # Verifies old WordPress URLs (npm run check:redirects)
├── scripts/connect-google-drive.ts # One-time Drive hookup for trip photos (npm run connect:drive)
├── public/crew-sw.js          # Crew app service worker (push notifications)
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
        ├── mcp/               # MCP tools: read-tools.ts, write-tools.ts
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

Twelve HTTPS endpoints. Public ones use origin-allow-list CORS; admin ones require a Firebase ID-token Bearer header.

### Public / customer-facing

| Function | Verb | Purpose |
|---|---|---|
| `getAvailability` | GET | Live slot capacity + month blackouts for the calendar UI |
| `createCheckoutSession` | POST | Firestore txn → creates `pending-payment` booking → returns Stripe Checkout URL. Refuses impossible dates, departures less than 60 min away (Eastern time), and dates over 365 days out |
| `releaseCheckoutHold` | POST | Token-authenticated. Expires an abandoned Stripe Checkout session, then cancels its `pending-payment` booking so the seats free up immediately |
| `stripeWebhook` | POST | Signature-verified, idempotent; confirms `pending-payment` bookings and triggers the Resend email. A payment on a booking that's already cancelled is refunded in full and emailed to `ADMIN_EMAIL`, never confirmed |
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
| `adminCreateBlackout` | Add blackout; optionally cancel + refund the affected bookings, or email each customer to pick a new date or take a full refund (`offerMove`, see [Scheduled jobs](#scheduled-jobs)) |
| `adminDeleteBlackout` | Remove blackout (does NOT restore cancelled bookings) |
| `adminUpdateTour` | Edit tour name, description, standard prices, active, included |
| `adminUpsertRateSeason` | Create / edit a seasonal or holiday rate: name, date range, prices by tour |
| `adminDeleteRateSeason` | Delete a rate season (those dates go back to standard prices) |
| `adminUpdateSettings` | Cancellation policy text + contact email |
| `adminAddCrewMember` | Add a swim guide / mate: name, email, password (stored as an scrypt hash) |
| `adminSetCrewPassword` | Replace a crew password; signs them out on every phone |
| `adminRemoveCrewMember` | Remove crew: deletes their sign-ins and notification subscriptions |

Every admin write goes to `auditLog/{entryId}` with the admin email, action, target id, and before/after payload.

The [MCP server](#mcp-server) can also call the edit, reschedule, mark, note, resend, blackout, tour, rate-season and inbox functions, using the `MCP_TOKEN` secret instead of Travis's sign-in. Those entries carry `via: 'mcp'` and show as "by automation" in Admin → Activity. The refund, cancel, settings, site-image, testimonial and crew functions don't accept the token.

### Firestore triggers

| Function | Fires on | Purpose |
|---|---|---|
| `notifyCrewOfBooking` | `bookings/{id}` written | Push notification to the crew's phones when a booking becomes `confirmed` |
| `sendCrewTestPush` | `crewPushTests/{id}` created | The crew app's "Send a test" button |
| `onContactMessageCreated` | `contactMessages/{id}` created | Emails Travis the contact-form message |

### Scheduled jobs

Marina time (America/New_York).

| Function | When | Purpose |
|---|---|---|
| `sendTourRemindersDaily` | 9:00 AM and 5:00 PM | Day-before reminder to everyone going out tomorrow: departure and arrive-by time, marina and directions, what to bring, the Open-Meteo forecast, the manage link. Skips bookings made in the last 12 hours (the confirmation covers them). The 5 PM run retries failures. **Off until launch:** `SEND_TOUR_REMINDERS` in `functions/.env.crmf-99aad` |
| `sendPostTourFollowups` | 7:00 AM | The day-after "how was it" email with the Instagram and Google review asks |
| `settleClosedBookings` | 6:00 AM | When Travis closes a departure with "pick a new date", the customer has until 3 days after the closed date to move or take the refund. This cancels and fully refunds the ones who did neither (old-site money gets a note for Travis to refund by hand) |

## Crew app

Travis's swim guides and mates have their own login at **`/crew`**, separate from admin. Crew can see confirmed upcoming tours (time, tour, headcount; no customer names or contact details), get a phone notification whenever a tour is booked, and upload the GoPro photos from each trip. They can't change anything else.

- **Adding crew:** Admin → **Crew**. Travis enters a name and email; the page makes up a random password (`k7m4-xq9p-2wht` style). After saving he gets a message with the link, email and password to text them. Passwords are stored as scrypt hashes, so they can't be shown again, only reset. A reset or removal signs that person out on every phone.
- **Installing:** on iPhone, open `/crew` in Safari → Share → **Add to Home Screen**, then open *Manatee Crew* from the home screen and sign in there. iOS only allows web notifications from a home-screen app (iOS 16.4+), and it keeps that app's sign-in separate from Safari's. On Android, Chrome works as-is; adding to the home screen is optional.
- **Notifications:** after signing in, tap **Turn on notifications**, then **Send a test**. Sign-in sessions last a year; 10 wrong passwords lock an account for 15 minutes.

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

   5. Set the two App Hosting secrets it prints (`GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`). Then uncomment the `GOOGLE_DRIVE_*` block in `apphosting.yaml` with the client ID filled in. Uncommenting first would fail the rollout, because App Hosting refuses to deploy with a missing secret. Until this is done, the crew app shows "Photo uploads aren't connected yet".

3. **Deploy** rules and functions (`firebase deploy --only firestore:rules,functions`), then push to `main`.

## MCP server

The site is also an [MCP](https://modelcontextprotocol.io) server at **`/api/mcp`**, so Claude (or any MCP client) can check the calendar and handle routine admin work. It runs inside the Next.js app on App Hosting. It reads Firestore directly and makes changes through the same admin Cloud Functions as the admin pages, so it gets the same validation, capacity checks, customer emails and audit log. It speaks Streamable HTTP, stateless, with JSON responses (`POST` only).

| Read-only | Changes |
|---|---|
| `get_availability`: open seats per departure, up to 62 days | `add_booking_note`: appends to the internal notes |
| `list_tours`: schedule, standard prices, seasonal rates, price on a date | `mark_booking`: completed / no-show |
| `list_bookings`: by date range, customer email or search text | `resend_confirmation_email` |
| `get_booking`: guests, contacts, payments, notes, reschedule requests, admin link | `edit_booking`: party size, guest list, contact details |
| `get_day_schedule`: each departure's seats and manifest | `reschedule_booking`: capacity-checked, emails the customer by default |
| `list_blackouts` | `create_blackout` / `delete_blackout`: never cancels bookings; lists the ones still on a closed departure |
| `list_contact_messages` | `update_tour`: name, description, included, active, price (dollars) |
| `list_reschedule_requests` | `upsert_rate_season` / `delete_rate_season` |
| | `update_contact_message` / `update_reschedule_request` |

**What it can't do:** refunds, cancellations, blackouts that cancel bookings, site settings, photos, reviews or crew. Answers about a booking include its admin link for those. Customer access tokens are never returned.

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

1. **App** — `npm ci` + `npm run lint` (soft) + `npm run build` (strict TS check)
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
