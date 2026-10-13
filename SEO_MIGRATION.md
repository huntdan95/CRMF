# SEO Migration Brief: WordPress → this Next.js site

**For Claude Code.** Put this file in the repo root and say: *"Read SEO_MIGRATION.md and work through it task by task. Stop and ask me about anything marked ASK."*

Goal: when `crystalrivermanateefun.com` switches from the old WordPress site to this app, Travis keeps his Google rankings. Google reviews live on his Google Business Profile, so they aren't affected by the site change. Rankings depend on every old URL landing somewhere sensible, the right pages being indexable, and the content that ranked carrying over.

Audit of the old site: Oct 13, 2026. All 39 URLs in its Yoast sitemaps are listed in **Appendix A**.

---

## Ground rules

- **Out of scope:** booking, Stripe, Cloud Functions, admin and Firestore logic. Don't change them except where a task says so.
- **Don't invent business facts** (prices, times, policies, ages, credentials). Where something is unknown, leave a `TODO(owner)` and list it in your final summary.
- **Production canonical is the apex domain:** `https://crystalrivermanateefun.com`. No `www`, no trailing slash, which is already `siteConfig.url`.
- **One commit per task.** `npm run build` and `npm --prefix functions run build` must pass after each one.
- The old site is still live, so you can fetch its pages to copy Travis's own content (FAQ, blog posts, images).

---

## Task 1: Replace the guessed redirects with the verified list

`next.config.ts` has a redirect list marked *"TODO (owner): pull the actual list of old URLs."* Most of its `/product/...` entries don't match real URLs. For example, the real URL is `/product/2hr-early-tour-shared/`, but the config has `/product/early-tour-shared`. As it stands, most old tour pages would 404.

**Do:**
1. Create `src/lib/legacy-redirects.ts` exporting the Appendix A list as typed data. `next.config.ts` and the checker in Task 2 both read from it.
2. Build `redirects()` from that list:
   - `from` values are written exactly as on the old site, **with** trailing slashes. Strip the trailing slash to get the Next.js `source`. Next's default trailing-slash handling (308) then applies first.
   - Skip entries whose action is `keep` (the path exists on the new site).
   - All redirects are `permanent: true`. The current `/my-account` rule is temporary; make it permanent.
3. Add these catch-alls **after** the specific rules, for old WordPress URLs not in the sitemap:
   - `/product/:slug*` → `/tours`
   - `/product-category/:slug*` → `/tours`
   - `/category/:slug*` → `/news`
   - `/tag/:slug*` → `/news`
   - `/author/:slug*` → `/about#captain`
   - `/feed` → `/news`
   - `/news/feed` → `/news`
   - `/comments/feed` → `/news`
4. Remove the guessed rules that don't correspond to a real old URL, such as `/about-us`, `/captain-travis`, `/contact-us`, `/manatee-manners`, `/blog/:slug*` and the wrong `/product/...` slugs. If you want to keep any as harmless extras, they must not conflict with Appendix A. Delete the `/blog/:slug*` → `/about#area` rule regardless, since `/news` replaces it.
5. On `/tours`, give the private-tours section `id="private"` if it has one, so `/tours#private` works. If there's no distinct private section, point that redirect at `/tours`.

**Done when:** every Appendix A `from` URL, requested exactly as written, ends at a 200 on its `to` path, in **2 hops or fewer**, with every hop a 301 or 308. Task 2 checks this.

---

## Task 2: Redirect checker script

Create `scripts/check-redirects.ts` and an npm script `check:redirects`.

- Usage: `npx tsx scripts/check-redirects.ts --base http://localhost:3000`. Run it later with `--base https://default--crmf-99aad.us-east4.hosted.app`, then the production domain.
- For each Appendix A entry, request `base + from` with `redirect: 'manual'` and follow up to 5 hops by hand, recording each status code and `Location`.
- Pass if the final status is 200, the final path matches `to` (ignore any `#fragment`), there are 2 or fewer hops, and every hop is 301 or 308.
- Also check that each catch-all from Task 1 works, using a made-up slug such as `/product/some-old-tour/`.
- Print a table and exit non-zero on any failure.

Run it against `npm run build && npm start` locally, and include the output in your summary.

---

## Task 3: Add a blog at `/news` that keeps the 5 old post URLs

The old site has 5 posts under `/news/<slug>/`. They're indexed and they're Travis's content, so they keep their exact URLs.

**Do:**
1. Add the routes `/news` (index) and `/news/[slug]` in the `(marketing)` group, styled like the existing marketing pages.
2. Store posts as Markdown at `content/news/<slug>.md` with frontmatter: `title`, `date`, `description`, `image`. Adding one small Markdown dependency is fine.
3. Migrate the 5 posts from the old site, using the URLs in Appendix A:
   - Keep the **exact slugs**, including the typo in `incredible-day-snorkling-with-manatees`.
   - Keep each post's title and publish date.
   - Copy the body text faithfully. Download its images into `public/images/news/` and add alt text.
   - Write a meta description for each one. The post `amazing-day-swimming-with-the-manatees` is about what manatees eat, but its current description describes a tour day. Write one that matches the topic.
   - `magnificent-manatee-footage-today` is a single sentence. Migrate it as-is and add `TODO(owner): expand this post`.
4. Each post gets:
   - a self-referencing canonical
   - `BlogPosting` JSON-LD (headline, datePublished, image, author "Capt. Travis Urbin")
   - a breadcrumb
   - a link to `/tours`
5. Add `/news` and every post to `sitemap.ts` using the post's real date, not `now`.
6. Link "News" from the footer. Adding it to the header nav is optional.

---

## Task 4: Keep the staging URL out of Google

The App Hosting URL `default--crmf-99aad.us-east4.hosted.app` currently returns `index, follow`. If Google indexes it before launch, it competes with the real domain.

**Do:**
1. In `src/proxy.ts`, add a host check that runs on every page:
   - Broaden the matcher. Exclude `_next/static`, `_next/image`, favicon, icons and the manifest.
   - For any host that isn't `crystalrivermanateefun.com`, add the response header `X-Robots-Tag: noindex, nofollow`.
   - Keep the existing `/admin` session-cookie check working exactly as it does now.
2. Make `src/app/robots.ts` host-aware using `headers()`. A non-production host gets `Disallow: /`.
3. Add host redirects controlled by an env var, `CANONICAL_HOST_REDIRECT`, declared in `apphosting.yaml` with a default of `"false"`. When it's `"true"`:
   - `www.crystalrivermanateefun.com` 301 → apex, keeping the path and query.
   - The `*.hosted.app` host 301 → apex, keeping the path and query.
   - Paths under `/api/` are exempt, along with anything the admin session or booking flow needs on the current host. Verify the booking flow still works with the flag on.
4. Document the flag in the README launch checklist.

---

## Task 5: Fix canonical and Open Graph inheritance

`src/app/layout.tsx` sets `alternates.canonical: 'https://crystalrivermanateefun.com'` and `openGraph.url` at the **root**. Any route without its own value inherits a canonical pointing at the homepage. That would quietly tell Google to drop the page, and any new route you add would inherit it too.

**Do:**
1. Remove `alternates.canonical` and `openGraph.url` from the root layout.
2. Set both explicitly on the homepage, in `(marketing)/page.tsx`.
3. Confirm every indexable route has a self-referencing canonical: home, tours, each tour, about, faq, gallery, reviews, contact, cancellation-policy, privacy, terms, news and each post. Noindex pages don't need one.

---

## Task 6: On-page fixes

1. **Missing H1s:** `/faq` and `/gallery` render only `SectionTitle` (h2). Give each page exactly one H1.
2. **Homepage title:** the old site ranked with *"Crystal River Manatee Tours On Manatee Fun"*. Start the new default title with that exact phrase, for example *"Crystal River Manatee Tours | Swim with Manatees with Capt. Travis"*. Keep it under about 65 characters. Keep "Pete's Pier", "shared" and "private" in the meta description.
3. **FAQ content:** the old `/frequently-asked-questions/` page has about 1,200 words; the new `/faq` has about 650.
   - Fetch the old page. Add any questions the new FAQ doesn't cover, worded to match the new site's facts.
   - Where the old and new sites conflict, such as minimum age or tour length, keep the new site's wording and list the conflict under `ASK` in your summary.
   - Don't change policy wording on `/cancellation-policy` or `/terms`.
   - The FAQ JSON-LD should cover every Q&A on the page.
4. **ASK, Crystal River page:** the old `/crystal-river/` was a standalone local guide (springs, lodging, things to do). The README checklist also mentions a `/crystal-river` page, but the current redirect sends it to `/about#area`. Ask whether to restore `/crystal-river` as its own page, which is better for local searches, or keep it as a section of /about. Until answered, keep the redirect.

---

## Task 7: Structured data and business details

1. The homepage and contact page describe the business as `TouristAttraction`. That type describes a place, not the business running the tours. Add a `LocalBusiness` node (a subtype such as `TravelAgency` is fine) with:
   - `name`, `url`, `telephone`, `address` and `geo` (all from `siteConfig`)
   - `image`
   - `priceRange` (for example `"$84–$895"`)
   - `sameAs`: Instagram, Facebook, and the Google Business Profile URL (`TODO(owner)` until known)

   Keep `TouristAttraction` only if it still makes sense alongside it.
2. **Don't add `aggregateRating` or `Review` markup built from the site's own testimonials.** Google treats self-collected reviews on a business's own site as ineligible for star snippets, and it can lead to a penalty.
3. **ASK, Facebook URL:** the old site links `facebook.com/urbin1`; `siteConfig` links `facebook.com/profile.php?id=61554023464570`. Which is the business page?
4. `siteConfig.contact.email` is still `TODO_OWNER_EMAIL`. Leave it, but make sure no page displays the placeholder text. Hide the email until it's set.
5. `siteConfig.marina` coordinates are approximate. Leave a `TODO(owner)` to replace them with the exact Google Business Profile pin.
6. After deploying, run the homepage, a tour page, `/faq` and a news post through Google's Rich Results Test, and note the results.

---

## Task 8: Launch runbook (add to the README launch checklist)

Add these as checklist items. They're owner and DNS tasks; don't run them.

**Before launch**
- [ ] Get access to the domain registrar, the Google Business Profile (as Primary Owner) and Search Console from the previous developer.
- [ ] Verify a **Domain property** in Search Console with a DNS TXT record, so it keeps working after the hosting move. Export 16 months of Performance data (Queries and Pages) as a baseline.
- [ ] ASK: the new site sends analytics to Firebase measurement ID `G-5GZX07YZTV`. The old site's GA4 (connected through Site Kit) is probably a different property. Should we link the old property for continuous reporting, or start fresh?
- [ ] Record every current DNS record, especially **MX and email TXT records** (SPF, DKIM), and lower the TTL 48 hours ahead.
- [ ] Run `npm run check:redirects` against the staging URL. It must pass cleanly.
- [ ] Run Lighthouse on the marketing pages (the README target is 90+).
- [ ] Pick a launch date outside manatee season (mid-November to March) if possible. A brief ranking dip costs the most in December.

**Launch**
- [ ] Add the apex and `www` domains in App Hosting and update the A and TXT records. **Don't touch the MX records.**
- [ ] Set the Functions secret `APP_BASE_URL=https://crystalrivermanateefun.com` and the Stripe live keys.
- [ ] Set `CANONICAL_HOST_REDIRECT=true` once SSL is active on the domain.
- [ ] Run `npm run check:redirects -- --base https://crystalrivermanateefun.com`.

**After launch**
- [ ] Submit `/sitemap.xml` in Search Console. Use URL Inspection to request indexing for the home page, `/tours`, `/faq` and the tour pages.
- [ ] Update the Google Business Profile booking link to `/book`.
- [ ] Watch Search Console's Pages and 404 reports weekly for 8 weeks, and add redirects for any old URL that shows up.
- [ ] Keep the WordPress backup for at least 90 days. Don't cancel the old hosting until DNS has fully propagated and email is confirmed working.

---

## Final summary to give the user

- The commit list
- `check:redirects` output (local, and staging if deployed)
- Every `TODO(owner)` and `ASK` item, in one list
- Rich Results Test results, if deployed

---

## Appendix A: Verified old URLs → new destinations

These are all 39 URLs from the old site's Yoast sitemaps (pages, posts, products and categories), captured Oct 13, 2026.

Actions:
- `keep`: same path on the new site; only the trailing slash changes, which Next handles.
- `redirect`: needs a rule.
- `new`: the path must be created (Task 3).

Old tour time slots map to the closest new start time. The old site had a sunset tour and an eco tour that aren't in the new catalog; those go to `/tours` until Travis confirms.

```json
[
  { "from": "/",                                              "to": "/",                               "action": "keep",     "note": "Homepage" },
  { "from": "/sample-page/",                                  "to": "/",                               "action": "redirect", "note": "WordPress default page" },
  { "from": "/services/",                                     "to": "/tours",                          "action": "redirect", "note": "Thin leftover" },
  { "from": "/charters/",                                     "to": "/tours",                          "action": "redirect", "note": "Thin leftover" },
  { "from": "/my-account/",                                   "to": "/contact",                        "action": "redirect", "note": "WooCommerce account; make permanent" },
  { "from": "/boat/",                                         "to": "/about",                          "action": "redirect", "note": "Placeholder page; no boat page on new site" },
  { "from": "/liability-waiver-example/",                     "to": "/terms#liability",                "action": "redirect", "note": "Waiver is now signed during checkout" },
  { "from": "/crystal-river/",                                "to": "/about#area",                     "action": "redirect", "note": "ASK: restore as standalone page? (Task 6.4)" },
  { "from": "/profile-page/",                                 "to": "/contact",                        "action": "redirect", "note": "Account utility" },
  { "from": "/checkout/",                                     "to": "/book",                           "action": "redirect", "note": "Already in next.config" },
  { "from": "/cart/",                                         "to": "/book",                           "action": "redirect", "note": "Already in next.config" },
  { "from": "/frequently-asked-questions/",                   "to": "/faq",                            "action": "redirect", "note": "Richest old page; merge content (Task 6.3)" },
  { "from": "/captain/",                                      "to": "/about#captain",                  "action": "redirect", "note": "Already in next.config" },
  { "from": "/charter-terms/",                                "to": "/cancellation-policy",            "action": "redirect", "note": "Old policy page" },
  { "from": "/contact/",                                      "to": "/contact",                        "action": "keep",     "note": "Trailing slash only" },
  { "from": "/charter-confirmation/",                         "to": "/book",                           "action": "redirect", "note": "Old booking utility" },
  { "from": "/wetsuit-sizing/",                               "to": "/book",                           "action": "redirect", "note": "Sizes are collected in the booking form" },
  { "from": "/private-manatee-swimming-tours/",               "to": "/tours#private",                  "action": "redirect", "note": "Keyword URL; /tours if no private section (Task 1.5)" },
  { "from": "/shop/",                                         "to": "/tours",                          "action": "redirect", "note": "Old 'Manatee Tours' menu item" },
  { "from": "/book-now/",                                     "to": "/book",                           "action": "redirect", "note": "Old main 'Book Now' button; high priority" },
  { "from": "/news/magnificent-manatee-footage-today/",       "to": "/news/magnificent-manatee-footage-today",       "action": "new", "note": "Migrate post (Task 3)" },
  { "from": "/news/incredible-day-snorkling-with-manatees/",  "to": "/news/incredible-day-snorkling-with-manatees",  "action": "new", "note": "Migrate post; keep the typo slug" },
  { "from": "/news/an-unforgettable-experience/",             "to": "/news/an-unforgettable-experience",             "action": "new", "note": "Migrate post" },
  { "from": "/news/amazing-day-swimming-with-the-manatees/",  "to": "/news/amazing-day-swimming-with-the-manatees",  "action": "new", "note": "Migrate post; fix meta description" },
  { "from": "/news/manatee-tours-manatee-habitat/",           "to": "/news/manatee-tours-manatee-habitat",           "action": "new", "note": "Migrate post" },
  { "from": "/category/news/",                                "to": "/news",                           "action": "redirect", "note": "Old blog index" },
  { "from": "/product/2hr-sunset-tour-private/",              "to": "/tours",                          "action": "redirect", "note": "Not in new catalog; ASK owner" },
  { "from": "/product/whole-day-tour-private/",               "to": "/tours/whole-day-private",        "action": "redirect", "note": "Current config has the wrong slug" },
  { "from": "/product/2hr-early-tour-private/",               "to": "/tours/morning-private",          "action": "redirect", "note": "Old 8am" },
  { "from": "/product/3hr-morning-tour-private/",             "to": "/tours/morning-private",          "action": "redirect", "note": "Old 8am; already in next.config" },
  { "from": "/product/2hr-midday-tour-private/",              "to": "/tours/mid-morning-private",      "action": "redirect", "note": "Old midday" },
  { "from": "/product/3hr-afternoon-tour-private/",           "to": "/tours/early-afternoon-private",  "action": "redirect", "note": "Old 1pm" },
  { "from": "/product/2hr-early-tour-shared/",                "to": "/tours/morning-shared",           "action": "redirect", "note": "Old 8am" },
  { "from": "/product/2hr-morning-tour-shared/",              "to": "/tours/mid-morning-shared",       "action": "redirect", "note": "Old 10:30am" },
  { "from": "/product/2hr-midday-tour-shared/",               "to": "/tours/mid-morning-shared",       "action": "redirect", "note": "Old 11am" },
  { "from": "/product/3hr-afternoon-tour-shared/",            "to": "/tours/early-afternoon-shared",   "action": "redirect", "note": "Old 2pm" },
  { "from": "/product/2hr-afternoon-ecotour-private/",        "to": "/tours",                          "action": "redirect", "note": "Eco tour not in new catalog; ASK owner" },
  { "from": "/product-category/manatee-tours/",               "to": "/tours",                          "action": "redirect", "note": "Covered by catch-all" },
  { "from": "/product-category/eco-tours/",                   "to": "/tours",                          "action": "redirect", "note": "Covered by catch-all" }
]
```
