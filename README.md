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
| Payments | Stripe (via "Run Payments with Stripe" Firebase Extension) |
| Email | Resend |
| Hosting | Firebase App Hosting (auto-deploy from GitHub `main`) |
| Source control | GitHub — [huntdan95/CRMF](https://github.com/huntdan95/CRMF) |

> Note: the original plan specified Next.js 15, but `create-next-app` is now pinning Next 16. App Router + RSC + React 19 are unchanged, so we're proceeding on 16.

## Repo layout

```
.
├── apphosting.yaml          # Firebase App Hosting config (env vars, scaling)
├── firebase.json            # Rules / functions / emulator config
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── functions/               # Cloud Functions workspace (separate npm project)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/index.ts
└── src/
    ├── app/                 # Next.js App Router pages
    │   ├── layout.tsx
    │   ├── page.tsx
    │   └── globals.css
    └── lib/firebase/
        ├── client.ts        # Web SDK (browser + RSC)
        └── admin.ts         # Admin SDK (server-only)
```

The booking flow (`/book/*`), customer self-service (`/my-booking/[id]`), and admin panel (`/admin/*`) land in later phases — see `rebuild-plan-v2` for the full sequence.

## Local development

### 1. Prerequisites

- Node 20+ (the repo is tested on Node 20 LTS; the Cloud Functions runtime is pinned to 20)
- A Firebase project on the Blaze (pay-as-you-go) plan — Cloud Functions requires it
- A Stripe account
- A Resend account with a verified sending domain

### 2. Install

```bash
npm install
npm install --prefix functions
```

### 3. Environment variables

Copy the template and fill in real values:

```bash
cp .env.local.example .env.local
```

The categories of values you'll need:

- **Firebase web config** — from Firebase console → Project settings → Your apps → Web app
- **Firebase Admin service account** — from Firebase console → Project settings → Service accounts → Generate new private key
- **Admin allowlist email** — the Google account Travis logs in with at `/admin`
- **Stripe** — secret key, publishable key, and (after deploying the webhook function) the webhook signing secret
- **Resend** — API key and the verified `From:` address

### 4. Run

```bash
npm run dev                          # Next dev server on http://localhost:3000
npm --prefix functions run build     # Compile Cloud Functions to functions/lib
```

### 5. (Optional) Firebase emulators

For testing Firestore rules, functions, and auth without touching the real project:

```bash
npm install -g firebase-tools        # one-time
firebase emulators:start             # ui at http://localhost:4000
```

Ports are configured in `firebase.json`.

## Deploying

Firebase App Hosting is wired to deploy on every push to `main`. To set it up the first time:

1. **Create the Firebase project** in the console and enable: Authentication (Google provider), Firestore (production mode), Cloud Storage, Cloud Functions, App Hosting. Upgrade to Blaze.
2. **Install the "Run Payments with Stripe" extension** in the Firebase console.
3. **Connect Firebase App Hosting to the GitHub repo** — auto-deploys from `main`.
4. **Set secrets** referenced in `apphosting.yaml`:
   ```bash
   firebase apphosting:secrets:set NEXT_PUBLIC_FIREBASE_API_KEY
   firebase apphosting:secrets:grantaccess NEXT_PUBLIC_FIREBASE_API_KEY --backend <backend-id>
   # …repeat for every secret listed in apphosting.yaml
   ```
5. **Deploy rules + indexes + functions manually the first time:**
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,storage,functions
   ```
6. **Custom domain:** in App Hosting, add `crystalrivermanateefun.com` → update DNS at the registrar → SSL provisions automatically.

## TODO before launch

- [ ] Replace `TODO_ADMIN_EMAIL` in `firestore.rules` and `storage.rules` with Travis's real Google account address (or migrate to a custom claim)
- [ ] Confirm `06:30` vs `07:30` early-tour start time (planning doc has both)
- [ ] Verify Travis's contact email — currently a TODO in the marketing-pages prompt
- [ ] Pull real photos from the old WordPress media library into `public/images/`
- [ ] Provide live Stripe keys + verify the Stripe account is approved for live mode
- [ ] Set up Resend domain verification and grab a production API key
- [ ] Add old-WordPress-URL redirects in `apphosting.yaml`

## Phase status

- [x] **Phase 1** — Project bootstrap (this commit)
- [ ] **Phase 2** — Marketing pages
- [ ] **Phase 3** — Tour data + Firestore seed
- [ ] **Phase 4** — Customer booking flow + Stripe Checkout
- [ ] **Phase 5** — Customer self-service (token-authenticated)
- [ ] **Phase 6** — Admin panel
- [ ] **Phase 7** — Polish + deploy
