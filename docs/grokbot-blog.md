# Grokbot's blog (Post Bot)

Every other week Post Bot, a Grok automation of its own, writes a post for the [News page](https://crystalrivermanateefun.com/news) with photos from Travis's Google Drive. The site holds each draft to the checks Yoast ran on the old WordPress site, plus a few more. Then it emails Travis the whole post, and **nothing goes on the website until he approves it**.

```
Post Bot (Grok automation, weekly)
  └─ connector: /api/mcp/blog            (blog tools only, no bookings)
       get_blog_brief      due? rules, pages to link, facts, Travis's notes
       list_blog_photos    trip GoPro shots + folders shared with the site
       view_blog_photo     a preview, to choose and write alt text
       check_blog_post     the Yoast-style check, repeat until it passes
       submit_blog_post    photos → Storage, draft → Firestore (pending-review)
                               └─ onBlogReviewRequested emails Travis the post
Travis: email → "Review and approve" → /blog-review/<slug>
       Approve & publish   → live at /news/<slug>
       Don't publish       → his note goes back to Post Bot next run
```

Post Bot is separate from the SEO bot: it has its own schedule and its own connector, and the SEO bot's job is untouched.

The code: `src/lib/seo-check.ts` (the check), `src/lib/blog-rules.ts` (timing), `src/lib/blog-publish.ts` (brief, submitting, approving), `src/lib/blog-photos.ts` (Drive photos), `src/lib/mcp/blog-tools.ts` (the tools), `src/app/(marketing)/blog-review/` (the review page), `functions/src/onBlogReviewRequested.ts` (the email).

## Timing

- One post every two weeks, counted from when the last approved post was submitted, so a slow approval doesn't push the next one back. Post Bot runs weekly (Grok has no every-two-weeks schedule), and the off-week run stops.
- While a draft waits for Travis, Post Bot writes nothing new. If he hasn't reviewed it after 7 days, the next run writes a fresh one and the old draft expires.
- If he turns a draft down, the next run writes a new one, and the brief passes on his note.
- A post he approves and later takes down still counts toward the two weeks.

## Setting it up

1. **Deploy.** `firebase deploy --only functions,firestore:rules` (the review email and the rules), then push to `main` for the site. The email links use the `APP_BASE_URL` Functions secret, so before the domain moves they point at the staging address.
2. **Photos.** Open **Admin → Blog**. The GoPro photos crew upload to each trip are used automatically. To add Travis's own photos, share a Drive folder (sub-folders count) with the address shown there, as a **Viewer**. That address is the site's App Hosting service account, normally `firebase-app-hosting-compute@crmf-99aad.iam.gserviceaccount.com`. The site sees only what's shared with it.
3. **Connector.** In Admin → Blog, open **Grokbot connector address** and copy it. It's `/api/mcp/blog?key=…`, with a key that opens only the blog tools. In Grok, add a custom connector with that address (on grok.com: Connectors → New connector → Custom; it needs a paid Grok plan) and name it **Manatee Fun Blog**.
4. **Post Bot.** Paste the prompt below into Grok's chat to create the automation. If the builder wants it entered by hand, use the same name, schedule and connector, and paste everything under "Instructions for every run".
5. **First run.** Run Post Bot once by hand. Nothing has been published yet, so it writes a draft straight away and Travis gets the email.

If submitting fails with a Storage permission error, give the App Hosting service account the **Storage Object Admin** role on the project's bucket (Google Cloud console → Cloud Storage → the bucket → Permissions).

## The Post Bot prompt

```text
Create a new automation called "Post Bot".

Schedule: weekly, Tuesdays at 9:00 AM Eastern.
Connector: use the "Manatee Fun Blog" connector on every run.

Instructions for every run:

You write the blog for Crystal River Manatee Fun (crystalrivermanateefun.com), Capt. Travis Urbin's small-group manatee snorkel tours in Crystal River, Florida. Use the Manatee Fun Blog connector for everything. Nothing you write goes on the website until Travis approves it.

1. Call get_blog_brief. If "due" is false, reply with its "status" line and stop. Do nothing else. Many runs stop here: a post goes out every other week, and nothing new is written while Travis is reviewing a draft.

2. If review.recentlyDeclined has a note from Travis, read it first and make sure this post deals with it.

3. Choose a topic: one of the in-season topicIdeas, or your own, that none of the existingPosts already covers. Choose a focus keyphrase of 2–4 words a visitor would type into Google (for example "manatee season crystal river" or "what to wear manatee tour"). It must not match any existing post's keyphrase.

4. Call list_blog_photos, then view_blog_photo on at least four of the most promising. Choose a featured photo (landscape, at least 1200px wide, a manatee clearly visible) and 2–4 more for the body. Prefer photos where manatees, the water, the boat or Capt. Travis are the subject. Skip any where a guest's face is the main subject, and any in which a child can be recognized. Write alt text that says what each photo actually shows.

5. Write the post, following every rule in the brief's "rules". In short:
   - 900–1,400 words of genuinely useful, specific information for someone planning a trip. No filler.
   - Plain Markdown. No # heading (the title is separate). ## sections, ### inside them where useful, a new subheading at least every 300 words, at least one bulleted or numbered list.
   - The focus keyphrase in the first sentence or two, in 30–75% of the ## subheadings, in at least one alt text, and about once every 150–200 words, spread through the post.
   - SEO title of 60 characters or fewer that starts with the keyphrase. Meta description of 120–156 characters with the keyphrase once, written to make someone click. Slug = the keyphrase, hyphenated.
   - Links: at least one to /tours, a tour page or /book; at least one to another page or post from linkablePages; and at least one https:// link to an authoritative outside source (FWC, USFWS, Save the Manatee Club, Florida State Parks, NOAA). Never use the keyphrase as link text.
   - Body photos as ![alt text](photo:<id>).
   - Short paragraphs and sentences, active voice, plenty of transition words (also, because, for example, then).
   - Facts only from the brief (facts, tours, site) and well-established public facts about manatees. No prices. Never invent guest stories, names, numbers, quotes or dates. Manatees are never touched or chased.
   - Warm and plain, like Capt. Travis talking to a guest. "We" for the business.

6. Call check_blog_post with the draft. Fix every RED item and as many ORANGE items as you can without making the writing worse, then check again. Repeat until "passes" is true. If it still doesn't pass after 5 rounds, stop and reply with the last report.

7. Call submit_blog_post once, with exactly the draft that passed. This emails Travis the full post to approve or send back with changes. Reply with the post's title and "Sent to Travis for review." Don't submit it again, and don't try to publish it yourself.
```

## What the check looks at

Each check is green, orange or red, like Yoast's traffic lights, and scored 9, 6 or 3. A draft can be sent to Travis only with **no red checks, an SEO score of 80+ and readability of 70+** (Yoast calls 70 green). `check_blog_post` returns the whole report so Grok can fix it.

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
- **Photos.** A featured photo at least 1200px wide (what Google Discover and social cards want), descriptive alt text of 10–125 characters (no file names or "photo of"), and no photo used on an earlier post. A trip photo deleted in Admin → Trip photos is never used, even if its Drive copy is still there. Photos are resized, turned upright and stripped of EXIF data (camera details and the GPS position) on the way to the site. The featured photo is cut to 16:9, 4:3 and 1:1, the three shapes Google asks for in Article markup.
- **Local relevance.** The post must mention Crystal River.
- **No prices.** They change with the season and would go stale; posts link to `/tours`.
- **Structure.** Clean heading levels, at least two `##` sections, and a list (Google quotes lists in featured snippets).
- **Unique title and meta description**, a short readable slug, and plain Markdown only (no HTML, no tables, no outside images: a table doesn't fit a phone, and the post pages don't style one).

The post page adds what Yoast's plugin did in the background: a self-referencing canonical, Open Graph and Twitter cards with the featured photo, `BlogPosting` structured data (headline, dates published and modified, word count, keyphrase, author with his profiles, all three image shapes), the post in the sitemap with its real date, responsive body images, and the featured photo preloaded for a fast first paint.

## Day to day

- **Reviewing.** Each draft arrives by email: the whole post, how it will look in Google, and its scores. **Review and approve** opens it on the site exactly as it will look (the link works once, and opening it changes nothing). There, **Approve & publish** puts it on the News page at once; **Don't publish** keeps it off, with an optional note that Post Bot reads before writing the next one. Drafts waiting for review are also under **Admin → Blog**, where signing in is enough. If the email didn't go out, Admin → Blog says so, and the site sends it again every hour while the draft waits.
- **Where posts appear.** Approved posts are on the News page (`/news`, linked from the footer and the mobile menu), each at `/news/<slug>`, and in the sitemap. Before the domain moves, that's the staging address.
- **Taking one down.** **Admin → Blog → Take off the website** removes an approved post at once; **Put back on the website** restores it.
- **Admin → Activity** lists each step: Grokbot sent a post for review, Travis approved it or turned it down (with his note), took it down or put it back.
- The connector key is worked out from `MCP_TOKEN`. Changing that token (README → MCP server) changes the key, so copy the new address from Admin → Blog into Grok.
