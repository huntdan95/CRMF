# Grokbot's blog

Every other week Grokbot writes a post for the [News page](https://crystalrivermanateefun.com/news), with photos from Travis's Google Drive, and publishes it on the site. The site holds each post to the checks Yoast ran on the old WordPress site, plus a few more. A post that doesn't pass can't go live, and Travis gets an email with the link to every post that does.

```
Grok automation (weekly)
  └─ connector: /api/mcp/blog          (blog tools only, no bookings)
       get_blog_brief      due? rules, pages to link, facts, topic ideas
       list_blog_photos    trip GoPro shots + folders shared with the site
       view_blog_photo     a preview, to choose and write alt text
       check_blog_post     the Yoast-style check, repeat until it passes
       publish_blog_post   photos → Storage, post → Firestore, page live
                               └─ onNewsPostPublished emails Travis
```

The code: `src/lib/seo-check.ts` (the check), `src/lib/blog-publish.ts` (brief, cadence, publishing), `src/lib/blog-photos.ts` (Drive photos), `src/lib/mcp/blog-tools.ts` (the tools), `functions/src/onNewsPostPublished.ts` (the email).

## Setting it up

1. **Deploy.** `firebase deploy --only functions,firestore:rules` (the email to Travis, and the rule for `newsPosts`), then push to `main` for the site.
2. **Photos.** Open **Admin → Blog**. The GoPro photos crew upload to each trip are used automatically. To add Travis's own photos, share a Drive folder (sub-folders count) with the address shown there, as a **Viewer**. That address is the site's App Hosting service account, normally `firebase-app-hosting-compute@crmf-99aad.iam.gserviceaccount.com`. The site sees only what's shared with it.
3. **Connector.** In Admin → Blog, open **Grokbot connector address** and copy it. It's `/api/mcp/blog?key=…`, with a key that opens only the blog tools. In Grok, add a custom connector with that address (on grok.com: Connectors → New connector → Custom; it needs a paid Grok plan) and name it **Manatee Fun Blog**.
4. **Automation.** In Grok, create an automation: name it **Manatee Fun blog post**, schedule it **weekly** (say, Tuesdays at 9:00 AM Eastern), @-mention the **Manatee Fun Blog** connector so it's used on every run, and paste the prompt below. Weekly is correct. Grok has no every-two-weeks schedule, so the site refuses a new post for 13 days after the last one. That makes it post every other week, and the off-week run just stops.
5. **First run.** Run the automation once by hand. Nothing has been published yet, so it writes a post straight away, and Travis gets the email.

If publishing fails with a Storage permission error, give the App Hosting service account the **Storage Object Admin** role on the project's bucket (Google Cloud console → Cloud Storage → the bucket → Permissions).

## The automation prompt

Paste this as the automation's instructions:

```text
You write the blog for Crystal River Manatee Fun (crystalrivermanateefun.com), Capt. Travis Urbin's small-group manatee snorkel tours in Crystal River, Florida. Use the Manatee Fun Blog connector for everything.

1. Call get_blog_brief. If "due" is false, reply with its "status" line and stop. Do nothing else.

2. Choose a topic: one of the in-season topicIdeas, or your own, that none of the existingPosts already covers. Choose a focus keyphrase of 2–4 words a visitor would type into Google (for example "manatee season crystal river" or "what to wear manatee tour"). It must not match any existing post's keyphrase.

3. Call list_blog_photos and view_blog_photo on at least four of the most promising. Choose a featured photo (landscape, at least 1200px wide, a manatee clearly visible) and 2–4 more for the body. Prefer photos where manatees, the water, the boat or Capt. Travis are the subject. Skip any where a guest's face is the main subject, and any where a child is. Write alt text that says what each photo actually shows.

4. Write the post, following every rule in the brief's "rules". In short:
   - 900–1,400 words of genuinely useful, specific information for someone planning a trip. No filler.
   - Plain Markdown. No # heading (the title is separate). ## sections, ### inside them where useful, a new subheading at least every 300 words, at least one bulleted or numbered list.
   - The focus keyphrase in the first sentence or two, in 30–75% of the ## subheadings, in at least one alt text, and about once per 150–200 words, spread through the post.
   - SEO title of 60 characters or fewer that starts with the keyphrase. Meta description of 120–156 characters with the keyphrase once, written to make someone click. Slug = the keyphrase, hyphenated.
   - Links: at least one to /tours, a tour page or /book, at least one to another page or post from linkablePages, and at least one https:// link to an authoritative outside source (FWC, USFWS, Save the Manatee Club, Florida State Parks, NOAA). Never use the keyphrase as link text.
   - Body photos as ![alt text](photo:<id>).
   - Short paragraphs and sentences, active voice, plenty of transition words (also, because, for example, then).
   - Facts only from the brief (facts, tours, site) and well-established public facts about manatees. No prices. Never invent guest stories, names, numbers, quotes or dates. Manatees are never touched or chased.
   - Warm and plain, like Capt. Travis talking to a guest. "We" for the business.

5. Call check_blog_post with the draft. Fix every RED item and as many ORANGE items as you can without making the writing worse, then check again. Repeat until "passes" is true. If it still doesn't pass after 5 rounds, stop and reply with the last report.

6. Call publish_blog_post with exactly the draft that passed. Reply with the post's title and URL.
```

## What the check looks at

Each check is green, orange or red, like Yoast's traffic lights, and scored 9, 6 or 3. A post publishes only with **no red checks, an SEO score of 80+ and readability of 70+** (Yoast calls 70 green). `check_blog_post` returns the whole report so Grok can fix it.

**Yoast's SEO checks**

| Check | Green when |
|---|---|
| Keyphrase length | 1–4 content words |
| Keyphrase in introduction | In one sentence of the first paragraph |
| Keyphrase density | 0.5–3% (over 3% is red: stuffing) |
| Keyphrase distribution | In every third of the post |
| Keyphrase in meta description | Once or twice |
| Keyphrase in SEO title | At the start |
| Keyphrase in slug | All of it |
| Keyphrase in subheadings | 30–75% of H2/H3s |
| Image keyphrase | In at least one alt text (30–70% with 5+ images) |
| Previously used keyphrase | No other post targets it (red if one does) |
| Text length | 900+ words (red under 600; Yoast's minimum is 300) |
| Outbound links | At least one |
| Internal links | At least one (see below) |
| Link keyphrase | The keyphrase isn't used as link text |
| Meta description length | 120–156 characters |
| SEO title width | 30–60 characters (red over 70) |
| Single title | No H1 in the body |
| Images | A featured photo and body photos, about one per 350 words |

**Yoast's readability checks:** subheading distribution (no section over 300 words), paragraph length (under 150 words), sentence length (at most 25% over 20 words), Flesch Reading Ease (60+), passive voice (10% of sentences or fewer), transition words (30%+), consecutive sentences (no three in a row starting with the same word).

**What we add**

- **Working links.** Every outside link is fetched; a dead one (404, no such site) is red. Every internal link must be a real page, and one has to lead to a tour (`/tours`, a tour page or `/book`) as well as one to another page or post.
- **Photos.** A featured photo at least 1200px wide (what Google Discover and social cards want), descriptive alt text of 10–125 characters (no file names or "photo of"), and no photo used on an earlier post. Photos are resized, turned upright and stripped of EXIF data (camera details and the GPS position) on the way to the site. The featured photo is cut to 16:9, 4:3 and 1:1, the three shapes Google asks for in Article markup.
- **Local relevance.** The post must mention Crystal River.
- **No prices.** They change with the season and would go stale; posts link to `/tours`.
- **Structure.** Clean heading levels, at least two `##` sections, and a list (Google quotes lists in featured snippets).
- **Unique title and meta description**, a short readable slug, and plain Markdown only (no HTML, no outside images).

The post page adds what Yoast's plugin did in the background: a self-referencing canonical, Open Graph and Twitter cards with the featured photo, `BlogPosting` structured data (headline, dates published and modified, word count, keyphrase, author with his profiles, all three image shapes), the post in the sitemap with its real date, responsive body images, and the featured photo preloaded for a fast first paint.

## Day to day

- Travis gets an email for every post. If something in one is wrong, **Admin → Blog → Hide from the website** takes it off at once. A hidden post still counts toward the two weeks, so hiding one doesn't make Grokbot post again straight away.
- **Admin → Activity** lists each post as "Grokbot published…", along with hides and restores.
- The connector key is worked out from `MCP_TOKEN`. Changing that token (README → MCP server) changes the key, so copy the new address from Admin → Blog into Grok.
