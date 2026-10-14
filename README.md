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
├── .github/workflows/ci.yml   # PR + main checks
└── src/
    ├── app/
    │   ├── (marketing)/       # Home, tours, captain, etc.
    │   ├── (booking)/         # /book/*, /my-booking/[id]
    │   ├── admin/             # /admin/login + /admin/(protected)/*
    │   ├── api/admin/session  # Login session cookie endpoint
    │   ├── error.tsx, not-found.tsx, sitemap.ts, robots.ts, manifest.ts
    │   └── layout.tsx
    ├── components/
    │   ├── marketing/         # Header, Footer, TourCard, …
    │   ├── booking/           # Calendar, SlotPicker, DetailsForm, …
    │   └── admin/             # AdminShell, calendar, booking actions, …
    └── lib/
        ├── firebase/          # client.ts, admin.ts, auth-server.ts, auth-client.ts
        ├── tours.ts           # Static catalog (kept in sync with seed)
        ├── site-config.ts     # Phone, marina, social
        ├── functions-client.ts, admin-client.ts, admin-firestore.ts
        ├── date.ts, refund-policy.ts, clsx.ts
        └── manifest-pdf.tsx   # Boarding manifest PDF renderer
```

## Local development

### 1. Prerequisites

- Node 20+ (CI tests on Node 20; Cloud Functions runtime is pinned to 20)
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
- **Admin allowlist email** — the Google account that logs in at `/admin` (`travisurbin1@gmail.com`)
- **Stripe** — secret + publishable keys (test mode for dev); the webhook signing secret comes after deploy
- **Resend** — API key and your verified `From:` address
- **`NEXT_PUBLIC_FUNCTIONS_BASE_URL`** — for local dev pointing at the emulator: `http://127.0.0.1:5001/<project>/us-central1`

### 4. Run

```bash
npm run dev                          # Next dev server on http://localhost:3000
npm --prefix functions run build     # Compile Cloud Functions to functions/lib
npm --prefix functions test          # Booking-rule and checkout-hold tests (no emulator needed)
```

### 4a. Seed the tour catalog

`scripts/seed.ts` writes the nine tour records from [src/lib/tours.ts](src/lib/tours.ts) into the Firestore `tours` collection. Idempotent — re-run any time you edit the catalog.

```bash
npm run seed:dry        # preview — no auth needed
npm run seed            # writes to the project in .env.local
npm run seed:emulator   # writes to the local emulator (FIRESTORE_EMULATOR_HOST=localhost:8080)
```

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
| `stripeWebhook` | POST | Signature-verified, idempotent; flips booking status, triggers Resend email |
| `fetchBooking` | POST | Token-authenticated read for `/book/confirmation/[id]` and `/my-booking/[id]` |
| `cancelBooking` | POST | Customer-initiated cancel with Stripe refund per policy |
| `requestReschedule` | POST | Customer reschedule request — emails Travis, logs to `rescheduleRequests` |

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
| `adminCreateBlackout` | Add blackout; optional cascade cancel + refund affected bookings |
| `adminDeleteBlackout` | Remove blackout (does NOT restore cancelled bookings) |
| `adminUpdateTour` | Edit tour name, description, prices, active, included |
| `adminUpdateSettings` | Cancellation policy text + contact email |

Every admin write goes to `auditLog/{entryId}` with the admin email, action, target id, and before/after payload.

## Deploying

### One-time setup

1. **Create the Firebase project** in the console (suggested: `crystal-river-manatee-fun`).
2. **Upgrade to the Blaze plan** — Cloud Functions and App Hosting both require it. Costs at this volume are single-digit dollars per month.
3. **Enable services:** Authentication (Google provider), Firestore (production mode), Cloud Storage, Cloud Functions, App Hosting.
4. **Authorize the admin Google account.** In Authentication, ensure `travisurbin1@gmail.com` has signed in (you can do this from the local dev app once you've populated `.env.local`). The Firestore rules and `NEXT_PUBLIC_ADMIN_EMAIL` are already wired to this address.
5. **Connect Firebase App Hosting to the GitHub repo** — pick this repo, branch `main`, set the rollout policy. Future pushes to `main` auto-deploy.

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
- [x] Old-URL redirects checked against the WordPress sitemaps. The list is in `src/lib/legacy-redirects.ts`, and `npm run check:redirects` verifies it.

### Moving the domain without losing rankings

The full plan is in [SEO_MIGRATION.md](SEO_MIGRATION.md). These are owner and DNS tasks.

**Before launch**

- [ ] Get access to the domain registrar, the Google Business Profile (as Primary Owner) and Search Console from the previous developer.
- [ ] Verify a **Domain property** in Search Console with a DNS TXT record, so it keeps working after the hosting move. Export 16 months of Performance data (Queries and Pages) as a baseline.
- [ ] **ASK, analytics:** the new site sends analytics to Firebase measurement ID `G-5GZX07YZTV`. The old site's GA4 (connected through Site Kit) is probably a different property. Link the old property for continuous reporting, or start fresh? Rankings aren't affected either way: Google doesn't use Analytics data for ranking, and ranking history lives in Search Console. If starting fresh, keep access to the old property (don't delete it) so its history stays readable.
- [ ] Record every current DNS record, especially **MX and email TXT records** (SPF, DKIM), and lower the TTL 48 hours ahead.
- [ ] Add `crystalrivermanateefun.com` and `www.crystalrivermanateefun.com` under Firebase Authentication → Settings → Authorized domains, so admin Google sign-in works on the new domain.
- [ ] Run `npm run check:redirects -- --base https://default--crmf-99aad.us-east4.hosted.app`. It must pass cleanly.
- [ ] Run Lighthouse on the marketing pages (target 90+ on Performance / Accessibility / Best Practices / SEO).
- [ ] Pick a launch date outside manatee season (mid-November to March) if possible. A brief ranking dip costs the most in December.

**Launch**

- [ ] Add the apex and `www` domains in App Hosting and update the A and TXT records. **Don't touch the MX records.**
- [ ] Set the Functions secret `APP_BASE_URL=https://crystalrivermanateefun.com` and the Stripe live keys.
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
