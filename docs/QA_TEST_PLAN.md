# Manatee Fun launch test run

> Live checklist with shared pass/fail results: https://claude.ai/artifact/6ASdXYy5gs3iogHqoa78Pf. This file is a snapshot of it.

Every test for the new site from the customer, crew and admin sides. Each test says who should run it (Trav, Grokbot, or either) and whether it must pass before launch.

## Start here: whole-trip tests

Each of these runs one real job through the customer, crew and admin sides at once. If these pass, most of the site works.

### E2E-1 · A customer books and pays, and everyone hears about it

**Who:** Trav · **Before launch**

Do this:

1. Do CRW-1 and CRW-2 first so a crew phone has notifications on.
2. On a different device, in a private browser window, open the site and tap "Check availability".
3. Pick a date at least 4 days out, Shared, 2 guests, the 8:00 AM departure, then Continue.
4. Fill in the details using an inbox you can check (not the admin Gmail). Name the guest "TEST" plus your name, pick a wetsuit size for each guest, tick all the boxes and tap "Pay $168".
5. Pay on Stripe (see "Before you start" for test-card vs real-card).

What should happen:

- The confirmation page says "You're booked. See you on the water." with the right tour, date, guests and amount.
- The test inbox gets "Tour confirmed for {date} — {tour}". Trav gets a copy (BCC).
- The crew phone shows "New booking: {day}" with "8:00 AM · … · 2 guests".
- Crew schedule shows the trip (no customer names). Crew with crew emails switched on get a "[CRMF]" new-booking email with the lead guest, guest count and wetsuit sizes.
- Admin Dashboard and Bookings show it as Confirmed, paid $168, with the wetsuit sizes.
- Stripe charged exactly what the site showed.

### E2E-2 · The customer cancels more than 3 days ahead and gets all their money back

**Who:** Trav · **Before launch**

Do this:

1. Open "Manage your booking" from the E2E-1 confirmation email.
2. Tap "Cancel booking". Read the dialog, then tap "Cancel and refund $168".

What should happen:

- Dialog says "More than 72 hours away — full refund." and shows the full amount.
- Page shows "Cancelled. Watch your email for the receipt."; the inbox gets "Cancellation confirmed — …" with the full refund.
- Stripe shows the refund. Admin shows the booking Cancelled, "Cancelled by: The customer", refunded $168.
- The trip disappears from the crew schedule after Refresh. Crew get a "[CRMF]" cancellation email but no phone notification (see Decisions).

### E2E-3 · Close a day that already has a booking on it

**Who:** Trav · **Before launch**

Do this:

1. Make a test booking (like E2E-1) on some date.
2. Admin → "Close a day" → that date → Why: Weather → "The whole day" → "Next: see who's booked".
3. Check the test booking is listed. Choose "Cancel them all and email each customer", then "Close it and cancel 1 booking".
4. Afterwards, in "Days you've closed", tap "Reopen" for that date.

What should happen:

- Summary says it cancelled 1 booking, emailed the customer, and the money is going back to their card.
- Test inbox gets "Your {tour} tour was cancelled by Capt. Travis" with "Closed for weather" and a full refund. The Note you typed is NOT in the email.
- While closed, /book shows that date unavailable and the admin calendar shows it grey.
- After Reopen the date is bookable again, and the cancelled booking stays cancelled.

### E2E-4 · A price change reaches the website and the Stripe charge

**Who:** Trav · **Before launch**

Do this:

1. Admin → Tours → Morning Shared: change the price per person from $84 to $85 → "Save changes".
2. Wait 1–2 minutes. Open the Morning Shared tour page and /book.
3. Start a 1-guest booking for that tour and go as far as the Stripe page (do not pay if Stripe is live).
4. Put the price back to $84.

What should happen:

- "Saved. The website shows it within a minute."
- Tour page, booking page and the Stripe page all show $85.
- After putting it back, they all show $84 again.

### E2E-5 · Leaving checkout without paying frees the seats

**Who:** Trav or Grokbot · **Before launch**

Do this:

1. Start a booking for 6 guests on an empty shared departure and tap Pay.
2. On the Stripe page, tap the back arrow at the top left.
3. Repeat, but this time close the tab on the Stripe page instead.

What should happen:

- Back arrow: the booking page shows "Checkout was cancelled, so nothing was charged. Your details are still here whenever you're ready." The departure still shows 6 seats left.
- Closed tab: the seats stay held for up to 30 minutes, then free up on their own.
- Admin lists both as Cancelled ("Left checkout without paying" / "Checkout session expired"). The expired one says "Cancelled by: You" even though nobody tapped anything (see Decisions).

### E2E-6 · A customer asks to move their tour, and Trav moves it

**Who:** Trav · **Before launch**

Do this:

1. From a test booking's "Manage your booking" page, tap "Request a different date", pick a date and slot, add a note, "Send request".
2. Try sending a second request.
3. Admin → "Reschedule requests" → "Open booking to move it" → "Move to another day or tour" → pick that date and tour, leave the email box ticked → "Move booking".
4. Back on Reschedule requests, tap "I moved it".

What should happen:

- Customer gets "We got your request to move your tour"; Trav gets "Reschedule request — {name} (…→…)"; crew get a "[CRMF]" reschedule-request email.
- The second request is refused: "You've already asked to move this tour, and Travis hasn't answered yet…"
- After the move the customer gets "Updated: Tour confirmed for {new date} — {tour}". The Manage page and crew schedule show the new date.
- The request moves from Open to "Moved".

### E2E-7 · A contact-form message reaches Trav and the admin inbox

**Who:** Trav · **Before launch**

Do this:

1. On /contact fill in a name, your test email, and a message of at least 10 characters. Tap "Send message".
2. In Trav's Gmail, open the message and tap Reply.
3. Admin → Messages.

What should happen:

- Page shows "Message sent".
- Trav gets "[crmf] … — from {name}". Reply goes to the customer's address, not to the website.
- Admin shows it under New. "I've replied" moves it to Replied. No email goes to the customer from these buttons.

## Customer side

The public website, booking, emails, and the self-service page customers use to cancel or move a tour.

### CUS-1 · Read every page on your phone for wrong facts

**Who:** Trav · **Before launch**

Do this:

1. Read the Home, Tours, each tour page, About, FAQ, Cancellation policy, Privacy and Terms pages.
2. Check prices, times (8:00, 10:30, 1:00, 3:30; whole day 7–3), "Pete's Pier Marina, 1 SW First Place", phone 352-586-7792.
3. Check every claim: "11+ years", USCG and other credentials, "almost always" seeing manatees in winter, the free date changes and no-manatee re-book promise, wetsuit sizes, free GoPro photos, parking, restroom, dry bag, Bimini top.
4. Check the business name reads "Crystal River Manatee Fun LLC" in the footer and Terms, exactly as registered with the state.
5. Check the "Where to stay / eat / do" lists on About.

What should happen:

- Everything is true. Write down anything that isn't, with the page name.

### CUS-2 · Phone menu, bottom bar and footer

**Who:** Trav or Grokbot · **Before launch**

Do this:

1. On a phone, open the menu (top right). Tap each link, then come back.
2. On Home, scroll down until the bottom bar ("Call" / "Check availability") appears.
3. Scroll to the very bottom of a few pages.

What should happen:

- Every menu link opens the right page and the menu closes. "Call" and "Book a tour" work.
- The bottom bar never covers the last footer links.

### CUS-3 · Tap-to-call, directions and social links

**Who:** Trav · **Before launch**

Do this:

1. Tap a phone number, "Get directions", the Instagram link and the Facebook link.

What should happen:

- Phone dials 352-586-7792. Directions open Google Maps at Pete's Pier Marina.
- Instagram opens @capt.travisurbin. Facebook opens the Crystal River Manatee Fun page.
- The map pin on the Contact page is in the exact right spot (it was set approximately).

### CUS-4 · Departures board on the home page matches the booking page

**Who:** Trav or Grokbot

Do this:

1. Compare the seat counts on the home "Next departures" board with /book for the same days.
2. Tap a cell.

What should happen:

- Seat counts match. Tapping a cell opens /book with that tour and date already picked.
- "Almost full" shows when 2 or fewer seats are left.

### CUS-5 · Gallery, reviews and news

**Who:** Trav

Do this:

1. Open Gallery, tap a photo, swipe/arrow to the next, close it.
2. Open Reviews and News, and one news post.

What should happen:

- Photos are ones you are happy to show. Reviews says "A selection of what guests have said, picked by Travis." and shows no star average.
- News: the "Magnificent manatee footage today" video plays on your iPhone (it is known not to play in Firefox).

### CUS-10 · Booking page basics

**Who:** Trav or Grokbot · **Before launch**

Do this:

1. Open /book. Use the guest − / + buttons; switch between Any tour, Shared, Private, Whole day.
2. Try tapping a past date. Try Continue before choosing a departure.
3. Pick a date and departure and look at the total.

What should happen:

- Guests go 1 to 6, no further. Filters show "$84 a seat", "$500 the boat", "$895, 7 AM–3 PM" (or current prices).
- Past dates can't be picked. Continue stays greyed out until a departure is chosen.
- Shared total = price × guests. Private = one boat price whatever the group size.

### CUS-11 · The details form catches mistakes and keeps what you typed

**Who:** Trav or Grokbot · **Before launch**

Do this:

1. On "Who's coming?", tap Pay with everything empty.
2. Type a bad email. Give the emergency contact the same phone number as yours. Leave a wetsuit size unpicked. Untick each checkbox in turn.
3. Fill everything in correctly, then refresh the page.

What should happen:

- "N things to fix above before you can pay." and the page jumps to the first problem.
- "Check this email address. We send your confirmation here." / "Use someone who won't be on the boat with you." / each box shows its own message, including "Please confirm you're 18 or older and agree to the terms."
- After refreshing, everything you typed is still there.

### CUS-12 · The checkout boxes say what you and your insurer want

**Who:** Trav · **Before launch**

Do this:

1. Read the four boxes: manatee manners video, liability waiver, cancellation policy, and "I'm 18 or older and agree to the Terms of Service, and I've read the Privacy Policy."
2. Tap "Watch the manatee manners video", and open every link in the boxes.

What should happen:

- The wording is what you want customers to agree to. The video plays. Each link opens the right page in a new tab.

### CUS-13 · Online booking closes 1 hour before departure

**Who:** Trav or Grokbot · **Before launch**

Do this:

1. On a tour day, look at /book shortly before and after the cutoff (7:00 AM for the 8:00 AM, 9:30 for 10:30, noon for 1:00, 2:30 for 3:30).

What should happen:

- Up to the cutoff the departure can be booked. After it, it shows "Call for same-day" and can't be picked.
- Same result with the phone set to a different time zone.

### CUS-14 · Shared and private can't clash

**Who:** Trav or Grokbot · **Before launch**

Do this:

1. After one shared seat is sold on a departure (E2E-1), look at that departure's Private option and that day's Whole day option.
2. Book a Private boat on a different, empty departure, then look at its Shared option.

What should happen:

- Private shows "Shared guests booked". Whole day shows "Day already has bookings".
- After the private booking, its Shared option shows "Booked privately".

### CUS-15 · A whole-day charter blocks the rest of the day

**Who:** Trav or Grokbot

Do this:

1. Book a whole-day charter on an empty date (test mode only), then look at that date.

What should happen:

- Every 2-hour departure that day shows "Not running", including the 3:30 PM one (see Decisions: should 3:30 stay open?).

### CUS-16 · A group too big for the seats left

**Who:** Trav or Grokbot

Do this:

1. On a departure with 4 seats left, set guests to 6.

What should happen:

- It shows "Only 4 seats left" and can't be chosen. The note says to call for full departures or groups over six.

### CUS-17 · The Stripe page matches the booking

**Who:** Trav or Grokbot · **Before launch**

Do this:

1. Go as far as the Stripe page for a shared booking, and once for a date covered by a seasonal rate.

What should happen:

- Stripe shows "{tour name} — {date}", "Shared tour, N guests", and the same total as the site.
- On the seasonal date it also says "· {season} rate".

### CUS-20 · Confirmation page, calendar and contact card

**Who:** Trav · **Before launch**

Do this:

1. On the confirmation page after paying, tap "Add to calendar", then "Save Travis to contacts".
2. Tap the "Need to make changes?" link.

What should happen:

- Calendar event is at the right time (8:00–10:00 AM Crystal River time), at the marina address, with a reminder the day before.
- Arrival says 20 to 30 minutes early, at the Pete's Pier parking lot, and to wear a swimsuit under clothes for the weather.
- Contact card is "Capt. Travis Urbin" with the right phone number.
- A weather forecast shows if the tour is within 14 days. The changes link opens the Manage page.

### CUS-21 · The confirmation email looks right and doesn't land in spam

**Who:** Trav · **Before launch**

Do this:

1. Book once with a Gmail address and once with an iCloud or Outlook address. Open the email on a phone.

What should happen:

- Arrives in the inbox (not spam) within a couple of minutes.
- Says arrive 20 to 30 minutes early at the Pete's Pier parking lot, guests with wetsuit sizes, amount paid, what to bring. "Manage your booking" works. Replying goes to Trav.

### CUS-30 · Refund amounts follow the 72-hour / 24-hour policy

**Who:** Trav or Grokbot · **Before launch**

Do this:

1. In test mode, make three bookings: 4+ days out, about 2 days out, and tomorrow.
2. Tap "Cancel booking" on each and read the dialog. Actually cancel the 2-day one.

What should happen:

- 4+ days: full refund. 2 days: "24-72 hours before your tour — 50% refund." Tomorrow: "Less than 24 hours — no online refund. Call Travis if there's an emergency."
- The 50% email and the Stripe refund are exactly half.

### CUS-31 · Cancelling after Trav already gave part of the money back

**Who:** Trav

Do this:

1. Trav refunds $20 of a $168 booking (ADM-10). The customer then cancels it 4+ days out.

What should happen:

- The dialog offers $148 (the rest), not $168, and the email and Stripe agree.

### CUS-40 · No placeholder text anywhere

**Who:** Trav or Grokbot · **Before launch**

Do this:

1. Look through the pages, the footer and the emails for "TODO", made-up emails or filler text.

What should happen:

- Nothing unfinished shows. The public contact email is hidden until a real one is set (see Decisions).
- Terms and Privacy say "Last updated: October 14, 2026".

### CUS-50 · Every link works and old WordPress addresses redirect

**Who:** Grokbot · **Before launch**

Do this:

1. Crawl every page from the home page and the sitemap. Record any link that returns an error.
2. Request these old addresses and record where each ends up: /frequently-asked-questions/, /book-now/, /captain/, /product/2hr-sunset-tour-private/, /product/2hr-early-tour-shared/, /charter-terms/, /liability-waiver-example/, /private-manatee-swimming-tours/, /crystal-river/, /news/an-unforgettable-experience/, /product/anything/, /tag/x/, /feed/.

What should happen:

- No broken links.
- Old addresses permanently redirect (308) to /faq, /book, /about#captain, /tours/late-afternoon-private, /tours/morning-shared, /cancellation-policy, /terms#liability, /tours#private, /about#area, /news/an-unforgettable-experience, /tours, /news, /news.

### CUS-51 · Search engines: staging hidden, live site visible

**Who:** Grokbot · **Before launch**

Do this:

1. On the staging address, check the X-Robots-Tag header and /robots.txt.
2. On crystalrivermanateefun.com (once launched), check the same, plus /sitemap.xml.
3. Run the home page, a tour page, /faq and a news post through Google's Rich Results Test.

What should happen:

- Staging: header "X-Robots-Tag: noindex, nofollow" and robots.txt "Disallow: /".
- Live: no X-Robots-Tag header; robots.txt allows / and lists the sitemap; every sitemap URL returns 200; /book, /admin, /my-booking are not in it.
- Structured data validates with no errors.

### CUS-52 · Phone layout, speed and accessibility

**Who:** Grokbot · **Before launch**

Do this:

1. Open every public page at 390 px wide.
2. Run Lighthouse (mobile) on Home, /tours, /tours/morning-shared, /faq, /book.
3. Record browser console errors on each page.

What should happen:

- Nothing scrolls sideways, overlaps or gets cut off.
- Lighthouse 90+ for Performance, Accessibility, Best Practices and SEO (list any below).
- No console errors.

### CUS-53 · Booking links can't be guessed or tampered with

**Who:** Grokbot · **Before launch**

Do this:

1. Using a test booking link from Trav: remove the ?t=… part, then change one character of it, on /book/confirmation/…, /my-booking/… and …/calendar.ics.
2. Open /tours/not-a-tour and /news/not-a-post.
3. Open /book?date=2026-11-31, /book?guests=9, a date 366 days out, and /book/2026-12-20.

What should happen:

- No booking details are ever shown: "Couldn't open your booking" / "Something's off" / an error for the .ics.
- Unknown tours and posts show "Page not found — The springs don't go that way."
- Impossible date ignored; guests snaps to 6; 366 days out not selectable; /book/2026-12-20 redirects to /book?date=2026-12-20.

### CUS-54 · Contact form validation and spam protection

**Who:** Grokbot

Do this:

1. Submit with empty fields, a bad email, and a 5-character message.
2. Submit one real message starting "GROKBOT TEST — please ignore".
3. Submit once with the hidden "Leave blank" field filled in.

What should happen:

- "Please enter your name", "Please enter a valid email", "Tell us a little more — at least 10 characters"; fields keep what was typed.
- Real message: "Message sent".
- Hidden field filled: shows a thank-you but nothing reaches Trav's inbox or admin Messages.

## Crew side

The Manatee Crew app at /crew: schedule, booking notifications, and trip photos.

### CRW-1 · Add a crew member

**Who:** Trav · **Before launch**

Do this:

1. Admin → Crew. Enter a name and an email (a real crew member, or a second email of yours). Keep the made-up password.
2. Tap "Add to crew", then try "Text it" and "Copy".
3. Try adding the same email again.

What should happen:

- Password looks like k7m4-xq9p-2wht. Panel says "{First} is on the crew — Send them this now."
- "Text it" opens Messages with the link, email, password and install steps. "Copy" copies the same.
- Second try: "{email} is already on the crew."

### CRW-2 · Install on an iPhone and turn on notifications

**Who:** Trav · **Before launch**

Do this:

1. Open the /crew link in Safari. Follow "On an iPhone? Add this to your Home Screen first." (Share → Add to Home Screen).
2. Open "Manatee Crew" from the home screen and sign in there.
3. Tap "Turn on notifications" → Allow → "Send a test". Go to the home screen.

What should happen:

- The app icon is the manatee and opens full screen.
- A "Notifications are working" notification pops up within a few seconds. ("Test sent" on screen only means it was sent, so you must actually see it arrive.)

### CRW-3 · Same thing on an Android phone

**Who:** Trav

Do this:

1. Open /crew in Chrome, sign in, "Turn on notifications", "Send a test".

What should happen:

- The test notification arrives.

### CRW-4 · Wrong password, and small typing slips

**Who:** Trav or Grokbot · **Before launch**

Do this:

1. Sign in with a wrong password.
2. Sign in with the email in capitals and the password pasted with a space before and after.

What should happen:

- "That email and password don't match. Check the text from Travis, or ask Travis to reset it. Too many wrong tries pauses sign-in for 15 minutes."
- Capitals and stray spaces still sign in.

### CRW-5 · Too many wrong passwords locks the account for 15 minutes

**Who:** Trav or Grokbot

Do this:

1. With a TEST crew account only: enter a wrong password 10 times, then the right one.
2. Then in Admin → Crew, reset that person's password and sign in with the new one.

What should happen:

- The right password is refused after 10 wrong ones, with the same message as a wrong password.
- After the admin reset, the new password works straight away.

### CRW-6 · The schedule shows the right trips and no customer details

**Who:** Trav · **Before launch**

Do this:

1. After E2E-1, open the crew app and tap Refresh. Book a second shared booking on the same departure and refresh again.

What should happen:

- "Upcoming tours" with "Today" / "Tomorrow" / weekday headings, "8:00 AM until 10:00 AM", Morning, Shared, "2 guests".
- Two bookings on the same boat show as one card: "N guests · 2 bookings".
- No names, emails, phone numbers or prices anywhere. People still in checkout don't appear.

### CRW-7 · Times stay in Crystal River time

**Who:** Trav or Grokbot

Do this:

1. Set the phone's time zone to Pacific and reopen the crew app.

What should happen:

- Times and Today/Tomorrow are unchanged.

### CRW-8 · What crew are and aren't told about changes

**Who:** Trav

Do this:

1. In admin, cancel one test booking, move another, and change a guest count. Watch the crew phone, then tap Refresh.

What should happen:

- The schedule updates after Refresh, but no notification arrives for any of these (see Decisions).

### CRW-9 · Reset a crew password

**Who:** Trav · **Before launch**

Do this:

1. Admin → Crew → "Reset password" → "Save new password". Text the new password to the phone.
2. On the crew phone, tap Refresh, then sign in with the new password.

What should happen:

- The phone is sent to the sign-in page. The new password works.
- On that same phone, notifications come back on their own.
- Activity log: "Set a new password for {name}" with "Signed out on N devices."

### CRW-10 · Remove a crew member

**Who:** Trav

Do this:

1. Admin → Crew → Remove → confirm. On their phone, tap Refresh and try signing in.

What should happen:

- They are sent to sign-in and the old password is refused. Activity log: "Removed {name} from the crew".

### CRW-11 · Crew can't get into the admin

**Who:** Trav or Grokbot · **Before launch**

Do this:

1. While signed into the crew app (in Safari), go to /admin and /admin/bookings.

What should happen:

- Lands on the admin Google sign-in page. No booking data shows.

### CRW-12 · Sign out

**Who:** Trav

Do this:

1. Tap "Sign out" on one phone, then make a test booking.

What should happen:

- That phone goes to sign-in and gets no booking notification. Other signed-in phones still get it.

### CRW-13 · Trip photos in the crew app open the trip's upload page

**Who:** Trav · **Before launch**

Do this:

1. Scroll to "Trip photos" in the crew app and tap a recent trip.

What should happen:

- It opens that departure's photo upload page (the same one linked in the 8 PM crew email). The old "upload straight to Google Drive" buttons are gone.
- Uploading is tested in NEW-29.

### CRW-20 · Crew and admin back-ends refuse anyone not signed in

**Who:** Grokbot · **Before launch**

Do this:

1. With no cookies, send POST requests to /api/crew/push, /api/crew/push/test and /api/crew/photos.
2. With no login, POST to an admin function such as https://us-central1-crmf-99aad.cloudfunctions.net/adminAddNote with an empty JSON body.
3. Open /crew and /admin/bookings with no cookies.

What should happen:

- Crew API: 401 {"error":"Signed out"}.
- Admin function: 401 "Missing Bearer token" (or "Invalid or expired token" with a junk token).
- Pages redirect to /crew/login and /admin/login.

## Admin side

Trav's admin at /admin: bookings, money, closing days, prices, reviews, photos and the activity log.

### ADM-1 · Sign in on the iPhone

**Who:** Trav · **Before launch**

Do this:

1. Open /admin/login in Safari → "Continue with Google" → pick travisurbin1@gmail.com.
2. Repeat on a computer.

What should happen:

- Lands on the Dashboard. No "missing initial state" or "redirect_uri_mismatch" error.

### ADM-2 · Any other Google account is refused

**Who:** Trav · **Before launch**

Do this:

1. Sign out, then sign in with a different Gmail.

What should happen:

- "You signed in as {email}, which doesn't have admin access. Tap "Continue with Google" again and choose t•••1@gmail.com." No admin pages open.

### ADM-3 · Admin pages are locked when signed out

**Who:** Trav or Grokbot · **Before launch**

Do this:

1. In a private window, open /admin/bookings.
2. Sign out of admin, then press Back and refresh.

What should happen:

- Both land on the sign-in page. No booking data shows.

### ADM-4 · Today and tomorrow run sheet

**Who:** Trav · **Before launch**

Do this:

1. Open the Dashboard with test bookings for today or tomorrow.

What should happen:

- Each departure shows the time, total guests, the tour, each customer name (tap opens the booking) and a Call button that dials them.
- "Next tour out" is right. Today / This week (Sun–Sat) / This month show guests, bookings and money (paid minus refunds) that match what you expect.

### ADM-5 · Calendar

**Who:** Trav

Do this:

1. Switch Month/Day, go forward and back, tap a booking, tick "Show cancelled".

What should happen:

- Colours: Confirmed green, Not paid yet orange, Completed pale green, No-show brown. Closed days grey.
- Tapping opens the booking. Cancelled ones appear struck through only when ticked. It doesn't update by itself; reload to see changes.

### ADM-6 · Find any booking

**Who:** Trav · **Before launch**

Do this:

1. Bookings → try Upcoming, Past, Cancelled, All.
2. Search by a customer name, part of a phone number, an email, and an old-website booking number.

What should happen:

- Each search finds the booking. Old-website bookings say "· old website". "Show more" loads the rest.
- Real bookings imported from the old site are all there (not just recent ones).

### ADM-7 · Edit guests or contact details

**Who:** Trav · **Before launch**

Do this:

1. On a test booking: "Edit guests or contact details" → change names, ages, emergency contact → "Save changes".
2. On a shared booking, raise the guest count above the seats left.

What should happen:

- "Booking updated." No email goes to the customer and the price doesn't change.
- Raising too far: "Cannot raise to N — only M spots free in this slot."

### ADM-8 · Move a booking

**Who:** Trav · **Before launch**

Do this:

1. "Move to another day or tour" → new date and tour, email box ticked → "Move booking".
2. Move it again with the box unticked.
3. Try moving onto a closed day, and onto a nearly full shared boat.

What should happen:

- Ticked: customer gets "Updated: Tour confirmed for …". Unticked: no email.
- Closed day: "{date} is blacked out." Full boat: "Only N spots left in that slot — your booking has M guests."
- The price is not adjusted (refund the difference by hand if the new tour is cheaper).

### ADM-9 · Refund part of the payment

**Who:** Trav · **Before launch**

Do this:

1. "Refund part of the payment" → $20 → Next → "Yes, refund $20".
2. Try refunding more than is left.

What should happen:

- "Refunded $20 to {first}." Money card: Refunded −$20, "Partly refunded". Stripe shows the $20 refund.
- No email goes to the customer. Too much: "That's more than they paid. The most you can refund is $X."

### ADM-10 · Cancel from admin after a partial refund

**Who:** Trav · **Before launch**

Do this:

1. On the booking from ADM-9: "Cancel booking". Add a reason, leave the email ticked → "Cancel and refund $X".

What should happen:

- Dialog offers only what's left ($148 of $168).
- Customer email: "The remaining $148 of your $168 payment has been refunded to your card ($20 was refunded earlier)." and includes your reason.
- Cancelling another one with the email unticked sends nothing.

### ADM-11 · Cancelling an old-website booking (look only)

**Who:** Trav · **Before launch**

Do this:

1. Open a real upcoming booking imported from the old site → "Cancel booking". Read the dialog, then tap "Keep the booking".

What should happen:

- It says "This was paid on the old website, so no money is refunded automatically. You'll need to refund $X yourself."
- The email box starts unticked. Nothing changes when you tap "Keep the booking".

### ADM-12 · After the tour: completed and no-show

**Who:** Trav

Do this:

1. On or after a test tour's date: "Mark as completed" on one, "They didn't show up" on another.

What should happen:

- Buttons only appear on or after the tour day. No email and no money moves.
- Both drop off the crew schedule. Review emails are tested in NEW-26.

### ADM-13 · Private notes, re-sending, passenger list

**Who:** Trav

Do this:

1. "Add a note", then edit it, then clear it.
2. Change the customer email, then "Email the confirmation again".
3. Tap "Print passenger list".

What should happen:

- Notes save and never appear on the customer's Manage page.
- The confirmation goes to the new email address.
- A PDF opens with names, ages, wetsuit sizes and a blank signature column. It covers one booking, not the whole boat (see Decisions).

### ADM-14 · Close only some departures

**Who:** Trav · **Before launch**

Do this:

1. Close a day → "Only some departures" → Morning only → close it. Look at /book for that date.
2. On another date, close Late afternoon only.

What should happen:

- Morning: 8:00 AM shows "Not running"; other times stay bookable; the whole-day charter is also closed.
- Late afternoon only: the whole-day charter stays bookable.

### ADM-15 · Close a day but keep the bookings

**Who:** Trav

Do this:

1. Close a day with a test booking and choose "Leave them booked. I'll contact everyone myself".

What should happen:

- Nothing is cancelled or emailed. "Still to do" lists the bookings you need to contact.

### ADM-16 · Turn a tour off and on

**Who:** Trav · **Before launch**

Do this:

1. Tours → Morning Private → untick "Taking bookings" → Save. Wait a minute. Then turn it back on.

What should happen:

- Off: /book hides it, the home board shows "Not running" for Private at 8:00, its tour page says it isn't running. Morning Shared still books.
- On again: everything is back. (The admin "Move" dialog still lists switched-off tours; see Decisions.)

### ADM-17 · Seasonal and holiday rates

**Who:** Trav · **Before launch**

Do this:

1. "Add seasonal or holiday rates" → name "TEST Holiday", one day, Shared $99 → "Save seasonal rates".
2. Add a month-long "TEST Season" at $90 that covers that day.
3. Check /book on the holiday, another day in the month, and a day outside it. Then delete both.

What should happen:

- An overlap warning appears. The holiday shows $99 and "TEST Holiday rate"; other days in the month $90; outside the month the standard price.
- Stripe shows the season name. After deleting, all dates go back to standard prices.

### ADM-18 · Edit tour wording and catch bad input

**Who:** Trav

Do this:

1. Change a description and "What's included", save, check the tour page.
2. Try an empty name and a price of 0.25.

What should happen:

- Changes show within a minute. "The tour needs a name." / "Prices must be at least $0.50."

### ADM-19 · Cancellation policy wording

**Who:** Trav

Do this:

1. Settings → edit "Cancellation policy wording" → "Save settings". Open /cancellation-policy after a minute.

What should happen:

- The new wording shows. Refund amounts don't change (they stay 72 h full, 24–72 h half).

### ADM-20 · Reviews

**Who:** Trav · **Before launch**

Do this:

1. "+ Add review" with text, author, stars, Google, link → "Save review". Then "Feature on home", "Unpublish", "Delete".

What should happen:

- Published reviews show on /reviews within a minute; featured ones on the home page (up to 3, featured first).
- Unpublished ones disappear from the site. Delete asks first.

### ADM-21 · Website photos from the iPhone

**Who:** Trav · **Before launch**

Do this:

1. Photos → "Home page — top photo" → "Upload a photo" from your camera roll. Edit the description → "Save description". Then "Remove photo".

What should happen:

- iPhone photo uploads, and the home page shows it within a minute.
- After Remove, the built-in photo comes back.

### ADM-22 · Messages and reschedule-request lists

**Who:** Trav

Do this:

1. Messages: try New / Replied / Archived, "Reply by email", "Mark unread". Reschedule requests: try each status button.

What should happen:

- The buttons only tidy the lists. They don't move bookings or email anyone.

### ADM-23 · Reports and the spreadsheet

**Who:** Trav

Do this:

1. Reports → last month → "Show report" → "Download spreadsheet (CSV)".

What should happen:

- The spreadsheet opens in Numbers or Excel. Money totals roughly match Stripe for that month (Stripe fees aside).

### ADM-24 · Activity log records everything you did

**Who:** Trav · **Before launch**

Do this:

1. After the tests above, open "Activity log". Use the filter and search.

What should happen:

- Every change above appears in plain English with Crystal River times, newest first; booking names link to the booking.

## Today's new work

Compliance fixes, the MCP server (lets Claude look things up and make safe changes), and the crew automation from AUTOMATION.md: crew emails, wetsuit sizes, trip-prep and directions emails, review requests, and guest photo uploads and gallery. Test each group once Daniel says it is merged and live.

### NEW-1 · Read the new Privacy Policy, Terms and cancellation policy

**Who:** Trav · **Before launch**

Do this:

1. Read /privacy, /terms and /cancellation-policy on your phone.
2. Look up the LLC on sunbiz.org and compare the exact name.

What should happen:

- Both legal pages say "Last updated: October 14, 2026" and name "Crystal River Manatee Fun LLC" exactly as registered.
- Privacy names who gets guest data: Stripe, Firebase, Resend, Google Drive, xAI's Grok, the weather service and YouTube. It describes analytics honestly, with Google's opt-out link and a Do Not Track statement.
- It says photos from a shared tour go to every group on that boat, and that guests can tell Travis at the dock if they'd rather not be photographed. Trav is fine promising that.
- Terms and the cancellation policy include free date changes (when the new departure has space) and a free re-book if you see no manatees.

### NEW-2 · New "18 or older" checkout box

**Who:** Trav or Grokbot · **Before launch**

Do this:

1. On the booking details step, leave "I'm 18 or older and agree to the Terms of Service…" unticked and tap Pay. Then tick it and open both links in it.

What should happen:

- Unticked: "Please confirm you're 18 or older and agree to the terms." and no checkout.
- Ticked: checkout opens. The Terms of Service and Privacy Policy links open in a new tab.

### NEW-3 · Wording fixes are live everywhere

**Who:** Grokbot · **Before launch**

Do this:

1. Search every public page and news post for: "99%", "endangered", "touch".
2. Open /reviews and /faq, and read the footer.

What should happen:

- No "99%" claim anywhere. News posts call manatees "threatened", never "endangered".
- The FAQ answer about touching manatees starts with "No."
- /reviews says "A selection of what guests have said, picked by Travis." and shows no average rating.
- The footer names "Crystal River Manatee Fun LLC".

### NEW-10 · Connect Claude and ask about today

**Who:** Trav

Do this:

1. After Daniel finishes the token setup: in Claude, Settings → Connectors → Add custom connector. Name "Manatee Fun", URL from Daniel (it ends in /api/mcp?key=…).
2. Ask Claude: "What's on the schedule today?", "Any new contact messages?", "How many seats are left on Saturday morning?"

What should happen:

- Answers match what the admin Dashboard, Messages and /book show.
- Treat the connector address like a password: anyone with it can see bookings.

### NEW-11 · A change made through Claude shows up in admin

**Who:** Trav

Do this:

1. Ask Claude to add the note "TEST note from Claude" to a test booking.

What should happen:

- The note appears on that booking in admin. Activity log shows "Added a note to …" followed by "· by automation".

### NEW-12 · Claude can't move money or cancel bookings

**Who:** Trav

Do this:

1. Ask Claude to cancel a test booking, then to refund $10 on it.

What should happen:

- Claude says it can't. Nothing changes on the booking or in Stripe.

### NEW-13 · Closing a day through Claude never cancels anyone

**Who:** Trav

Do this:

1. Ask Claude to close a test date that has a test booking on it. Then ask it to reopen the date.

What should happen:

- The date closes on /book, but the booking stays confirmed. Claude lists who is still booked so you can contact them.
- After reopening, the date is bookable again.

### NEW-14 · The MCP address refuses anyone without the key

**Who:** Grokbot · **Before launch**

Do this:

1. Send a POST with body {} to /api/mcp on the site with no key, then with ?key=wrong, then with the header "Authorization: Bearer wrong".
2. Send a GET to /api/mcp.

What should happen:

- Each POST returns 401 "Unauthorized." (or 503 "The MCP endpoint isn't set up on this site yet." if setup isn't finished). No booking data ever appears.
- GET returns 405 "Method not allowed."

### NEW-15 · Customers' private links stay private

**Who:** Trav

Do this:

1. Ask Claude for the "Manage your booking" link of a test booking.

What should happen:

- Claude can show the booking details but not the customer's private link.

### NEW-20 · Set up the crew email list

**Who:** Trav · **Before launch**

Do this:

1. Admin → Crew. If the list is empty, use the one-tap button that adds Travis, Lacy, Faith and Megan.
2. Fill in each person's role, email and phone, and turn crew emails on or off per person.

What should happen:

- Everyone saves. Lacy, Faith and Megan get no crew emails until their email addresses are filled in.
- Phone numbers are stored only; nothing is texted.

### NEW-21 · Instant crew emails

**Who:** Trav · **Before launch**

Do this:

1. With two crew on the list (one with crew emails on, one off): make a test booking, cancel it from the customer's Manage page, and send a reschedule request on another.

What should happen:

- The crew member with emails on gets one "[CRMF]" email for each: lead guest name and phone, guest count, wetsuit sizes and an admin link.
- The crew member with emails off gets nothing. Nobody gets the same email twice.

### NEW-22 · Wetsuit sizes from booking to boat

**Who:** Trav or Grokbot · **Before launch**

Do this:

1. Book with a size for each guest (one Adult size, one Kids size).
2. Admin → Settings: remove one size from the wetsuit list and save. Start another booking.

What should happen:

- Sizes show on the admin booking page, in "Edit guests or contact details", on the passenger list PDF and in the confirmation email.
- The removed size no longer appears at checkout.

### NEW-23 · 8 PM crew email for tomorrow

**Who:** Trav

Do this:

1. The evening before a test trip, check a crew inbox. Also check on a night with no trips the next day.

What should happen:

- At 8 PM crew get tomorrow's trips in time order, each with a wetsuit-size tally, notes, passenger-list links and that trip's photo upload link.
- No email on a night with no trips.

### NEW-24 · Trip-prep email 3 days before

**Who:** Trav · **Before launch**

Do this:

1. Make test bookings 5 days out, 2 days out, and about 8 hours out. Move one to a new date.

What should happen:

- 5 days out: the prep email arrives about 72 hours before. 2 days out: within the hour. 8 hours out: no prep email (the directions email covers it).
- After the move, the prep email comes again for the new date.

### NEW-25 · Directions email on the day

**Who:** Trav · **Before launch**

Do this:

1. On a test trip day, watch the customer inbox.

What should happen:

- It arrives 2 hours before departure but never before 6 AM (8:00 AM tour → 6:00 AM; 10:30 → 8:30).
- It says to meet in the Pete's Pier parking lot 20 to 30 minutes early and to wear a swimsuit under clothes for the weather.

### NEW-26 · Review requests after a trip

**Who:** Trav · **Before launch**

Do this:

1. Admin → Settings: enter the Google review link and save.
2. After a day with three test bookings: at 6 PM check Trav's inbox. Open Admin → Review requests and choose Send now on one, Hold on one, Didn't sail on one.

What should happen:

- 6 PM: Trav gets the day's list. "Send now" emails at once; the others wait for 7 PM.
- Hold: that guest gets the request 3 days after the trip. Didn't sail: no email ever.
- The email asks for an honest review, good or bad, includes the marina address, and its Google button opens your review page.

### NEW-27 · Private feedback form

**Who:** Trav or Grokbot

Do this:

1. From a review-request email, open the private feedback link (/feedback/…) and send a short message.

What should happen:

- A thank-you shows, and Trav gets the feedback by email right away.

### NEW-28 · Connect Google Drive for trip photos

**Who:** Trav · **Before launch**

Do this:

1. After Daniel's one-time setup: Admin → Settings → "Google Drive for trip photos" → "Connect Google Drive". Sign in and allow Drive.

What should happen:

- The page shows the connected account, a link to the "CRMF Trips" folder and a Disconnect button.

### NEW-29 · Upload trip photos with no login

**Who:** Trav · **Before launch**

Do this:

1. Open a test trip's upload link (from the 8 PM crew email or the crew app) on a phone that isn't signed in to anything.
2. Upload several iPhone photos and one video. Try a PDF.

What should happen:

- Photos and video upload. They appear in Admin → Trip photos and in Drive under "CRMF Trips", in that trip's folder.
- The PDF is refused. A link for a trip more than 7 days old no longer works.

### NEW-30 · Guests get one photo email and a gallery

**Who:** Trav · **Before launch**

Do this:

1. The morning after a test trip with photos, check both customer inboxes from that boat. Open the gallery and download one photo, then "Download all".

What should happen:

- At 9 AM each guest gets one photo email (not two). Both groups on the boat see the same gallery.
- Single download and the zip both work. Photos added later go out once uploads stop for an hour.
- A trip with no photos shows "no photos yet".

### NEW-31 · Delete a trip photo

**Who:** Trav

Do this:

1. Admin → Trip photos → open a trip → delete one photo.

What should happen:

- It disappears from the guest gallery and from Google Drive.

### NEW-32 · Arrival and photography wording

**Who:** Grokbot

Do this:

1. Search every public page and the booking pages for "15 minutes".
2. Open /terms#photography.

What should happen:

- Arrival always says 20 to 30 minutes early and the Pete's Pier parking lot; "15 minutes" appears nowhere.
- The photography terms name TikTok and Google and describe the shared guest gallery.

## Digital waiver (only once merged)

Built and waiting on its own branch for the attorney and insurer sign-off, and a separate session is still hardening it. Skip this section until Daniel says it is live.

### WVR-1 · An adult signs on their phone

**Who:** Trav · **Before launch**

Do this:

1. From a test confirmation email, tap "Sign the waiver". Tap your name, fill in the details, initial each section, sign with your finger, tap "Sign waiver".

What should happen:

- "Signed. Thanks, {first}!" with a PDF download. An email "Your signed waiver for {date}" arrives with the PDF attached.
- The PDF shows the right name, date, initials and signature.

### WVR-2 · A parent signs for kids

**Who:** Trav · **Before launch**

Do this:

1. Sign as a parent, add a child under 18, tick the guardian box.
2. Again, choosing "No, I'm only signing for my kids", and leave the adult on the boat blank.

What should happen:

- The Florida minor addendum and its large-print notice appear, with an extra section to initial.
- Not going: it asks for the adult who will be with them on the boat and won't sign without one.

### WVR-3 · Who has signed, from admin

**Who:** Trav · **Before launch**

Do this:

1. Open the test booking in admin, then Admin → Waivers.

What should happen:

- The booking's Waivers card shows "N of M signed", names marked signed or not, and "View PDF". "Copy signing link", "Text it" and "Send waiver reminder" work.
- Admin → Waivers lists the next two weeks of trips; "Only trips missing waivers" and the name search work.

### WVR-4 · Day-before reminder for anyone unsigned

**Who:** Trav

Do this:

1. Have a test booking for tomorrow where one guest hasn't signed. Check the inbox after 3 PM.

What should happen:

- "Tomorrow: 1 person still needs to sign the waiver" with a "Sign the waiver" button. Sent once.

### WVR-5 · Broken or early waiver links

**Who:** Grokbot

Do this:

1. Open a waiver link with part of the key removed. Open one for a booking still in checkout.

What should happen:

- "This waiver link doesn't work" and "This booking isn't confirmed yet". No booking details shown.

### WVR-6 · Attorney sign-off before going live

**Who:** Trav · **Before launch**

Do this:

1. Open Admin → Waivers.

What should happen:

- The red banner "The waiver text hasn't been signed off by a lawyer yet." must be gone before customers are asked to sign.

## Decisions for Trav

1. If Grokbot is still set up to email trip photos from Google Drive (the old "_READY_TO_SEND.txt" setup), switch that off when the crew automation goes live. The site now sends the photo emails itself, and guests would get two.
2. Crew phones get a notification only for new paid bookings. The new crew emails also cover customer cancellations and reschedule requests, but nothing tells crew when Trav cancels, moves or edits a booking in admin. Is that enough?
3. A whole-day charter (7 AM–3 PM) also blocks the 3:30 PM tour that day. Keep that, or let 3:30 stay bookable?
4. Refund timing says "3–5 business days" in the cancel dialog and email, but "5–10 business days" on the cancelled confirmation page. Which is right?
5. Checkouts that time out show "Cancelled by: You" in admin even though Trav didn't touch them. Relabel as "Checkout expired"?
6. The admin "Move" dialog still lists tours that are switched off.
7. There is no public contact email on the site yet. Which address should customers see?
8. The passenger list PDF is per booking, not per boat departure. Is a whole-departure list wanted for the dock?
9. Set the Google review link in Admin → Settings, or the review email has no Google button. The email's Facebook link goes to the "Travis Urbin" profile, not the business page.
10. The new Privacy Policy says guest names, emails and trip photos go to xAI's Grok (Grokbot). The crew automation took Grokbot out of the photo emails. If Grokbot no longer gets guest data, that line should come out. If it still does (for example through this testing or the MCP server), use xAI's business API, not a consumer Grok account.
11. Giving Grokbot the MCP connection would let it read every booking, including names, emails and phone numbers. Decide that on purpose.
12. Old-website bookings held with a deposit now get the guest emails (prep, directions, review) and appear on crew lists. Keep that?
13. Trav is BCC'd on every thank-you email, so he'll get a copy of each guest's review request every evening.
14. Crew emails link to admin pages, which crew can't open without Trav's login.
15. Still open from the compliance review: are the credentials on the site current, sales tax on tours, and seller-of-travel registration.
16. The "Note" on a closed day says "only you see this", but it is stored where a technical person could read it. Don't put private details there.
17. The weather box on the confirmation page says "we'll email you if anything looks dicey", but no weather email exists.
18. The Tours page always says the private boat "costs less than six shared seats", even if seasonal prices make that untrue.
19. The marina map pin and coordinates were set approximately.
20. Admin sign-in lasts 5 days. Signing out on one device does not sign out others.

## Brief for Grokbot

Replace the bracketed placeholders before pasting.

```text
You are testing the new Crystal River Manatee Fun website (manatee boat tours in Crystal River, Florida) before it launches. Work through every test below in a real browser and report what you find. Do not fix anything.

SITE: {SITE_URL}
TEST INBOX (use on every booking and form): {TEST_EMAIL}
TEST CREW LOGIN (crew app at /crew): {CREW_LOGIN}

SAFETY RULES — follow all of them:
1. Never type real card details. Only finish a payment when the Stripe page shows "Test mode" or "Sandbox". Then use card 4242 4242 4242 4242, any future expiry, any 3-digit CVC, ZIP 34429. If Stripe is not in test mode, stop at the Stripe page and mark payment steps "Skipped (live payments)".
2. Put "GROKBOT TEST" in every name field, and use the test inbox above for every email field.
3. Book only dates at least 7 days from today unless a test says otherwise. At the end, cancel every booking you made from its "Manage your booking" link, and list their booking refs.
4. Never sign in to /admin and never try to guess passwords. The only crew login you may use is the test one above.
5. Send no more than 3 contact-form messages in total, each starting "GROKBOT TEST — please ignore".
6. No load testing, no flooding, no attempts to get around security beyond the exact checks listed.
7. If something would cost real money or email real customers, stop and ask.
8. You no longer send trip-photo emails to guests; the website does that now. Don't email any guest.

REPORT FORMAT:
First a table with one row per test: Test ID | Result (Pass / Fail / Skipped) | What you saw (one line) | Evidence (URL, HTTP status, screenshot name).
Then, for every Fail: the steps to reproduce, what you expected, what happened, browser and screen width.
Then the booking refs you created and whether each was cancelled.

TESTS:

[E2E-5] Leaving checkout without paying frees the seats  (before launch)
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. Start a booking for 6 guests on an empty shared departure and tap Pay.
   2. On the Stripe page, tap the back arrow at the top left.
   3. Repeat, but this time close the tab on the Stripe page instead.
  Expect:
   - Back arrow: the booking page shows "Checkout was cancelled, so nothing was charged. Your details are still here whenever you're ready." The departure still shows 6 seats left.
   - Closed tab: the seats stay held for up to 30 minutes, then free up on their own.
   - Admin lists both as Cancelled ("Left checkout without paying" / "Checkout session expired"). The expired one says "Cancelled by: You" even though nobody tapped anything (see Decisions).

[CUS-2] Phone menu, bottom bar and footer  (before launch)
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. On a phone, open the menu (top right). Tap each link, then come back.
   2. On Home, scroll down until the bottom bar ("Call" / "Check availability") appears.
   3. Scroll to the very bottom of a few pages.
  Expect:
   - Every menu link opens the right page and the menu closes. "Call" and "Book a tour" work.
   - The bottom bar never covers the last footer links.

[CUS-4] Departures board on the home page matches the booking page
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. Compare the seat counts on the home "Next departures" board with /book for the same days.
   2. Tap a cell.
  Expect:
   - Seat counts match. Tapping a cell opens /book with that tour and date already picked.
   - "Almost full" shows when 2 or fewer seats are left.

[CUS-10] Booking page basics  (before launch)
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. Open /book. Use the guest − / + buttons; switch between Any tour, Shared, Private, Whole day.
   2. Try tapping a past date. Try Continue before choosing a departure.
   3. Pick a date and departure and look at the total.
  Expect:
   - Guests go 1 to 6, no further. Filters show "$84 a seat", "$500 the boat", "$895, 7 AM–3 PM" (or current prices).
   - Past dates can't be picked. Continue stays greyed out until a departure is chosen.
   - Shared total = price × guests. Private = one boat price whatever the group size.

[CUS-11] The details form catches mistakes and keeps what you typed  (before launch)
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. On "Who's coming?", tap Pay with everything empty.
   2. Type a bad email. Give the emergency contact the same phone number as yours. Leave a wetsuit size unpicked. Untick each checkbox in turn.
   3. Fill everything in correctly, then refresh the page.
  Expect:
   - "N things to fix above before you can pay." and the page jumps to the first problem.
   - "Check this email address. We send your confirmation here." / "Use someone who won't be on the boat with you." / each box shows its own message, including "Please confirm you're 18 or older and agree to the terms."
   - After refreshing, everything you typed is still there.

[CUS-13] Online booking closes 1 hour before departure  (before launch)
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. On a tour day, look at /book shortly before and after the cutoff (7:00 AM for the 8:00 AM, 9:30 for 10:30, noon for 1:00, 2:30 for 3:30).
  Expect:
   - Up to the cutoff the departure can be booked. After it, it shows "Call for same-day" and can't be picked.
   - Same result with the phone set to a different time zone.

[CUS-14] Shared and private can't clash  (before launch)
  Note: ONLY IF the Stripe page shows "Test mode" or "Sandbox"; otherwise mark Skipped (live payments).
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. After one shared seat is sold on a departure (E2E-1), look at that departure's Private option and that day's Whole day option.
   2. Book a Private boat on a different, empty departure, then look at its Shared option.
  Expect:
   - Private shows "Shared guests booked". Whole day shows "Day already has bookings".
   - After the private booking, its Shared option shows "Booked privately".

[CUS-15] A whole-day charter blocks the rest of the day
  Note: ONLY IF the Stripe page shows "Test mode" or "Sandbox"; otherwise mark Skipped (live payments).
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. Book a whole-day charter on an empty date (test mode only), then look at that date.
  Expect:
   - Every 2-hour departure that day shows "Not running", including the 3:30 PM one (see Decisions: should 3:30 stay open?).

[CUS-16] A group too big for the seats left
  Note: ONLY IF the Stripe page shows "Test mode" or "Sandbox"; otherwise mark Skipped (live payments).
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. On a departure with 4 seats left, set guests to 6.
  Expect:
   - It shows "Only 4 seats left" and can't be chosen. The note says to call for full departures or groups over six.

[CUS-17] The Stripe page matches the booking  (before launch)
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. Go as far as the Stripe page for a shared booking, and once for a date covered by a seasonal rate.
  Expect:
   - Stripe shows "{tour name} — {date}", "Shared tour, N guests", and the same total as the site.
   - On the seasonal date it also says "· {season} rate".

[CUS-30] Refund amounts follow the 72-hour / 24-hour policy  (before launch)
  Note: ONLY IF the Stripe page shows "Test mode" or "Sandbox"; otherwise mark Skipped (live payments).
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. In test mode, make three bookings: 4+ days out, about 2 days out, and tomorrow.
   2. Tap "Cancel booking" on each and read the dialog. Actually cancel the 2-day one.
  Expect:
   - 4+ days: full refund. 2 days: "24-72 hours before your tour — 50% refund." Tomorrow: "Less than 24 hours — no online refund. Call Travis if there's an emergency."
   - The 50% email and the Stripe refund are exactly half.

[CUS-40] No placeholder text anywhere  (before launch)
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. Look through the pages, the footer and the emails for "TODO", made-up emails or filler text.
  Expect:
   - Nothing unfinished shows. The public contact email is hidden until a real one is set (see Decisions).
   - Terms and Privacy say "Last updated: October 14, 2026".

[CUS-50] Every link works and old WordPress addresses redirect  (before launch)
  Do:
   1. Crawl every page from the home page and the sitemap. Record any link that returns an error.
   2. Request these old addresses and record where each ends up: /frequently-asked-questions/, /book-now/, /captain/, /product/2hr-sunset-tour-private/, /product/2hr-early-tour-shared/, /charter-terms/, /liability-waiver-example/, /private-manatee-swimming-tours/, /crystal-river/, /news/an-unforgettable-experience/, /product/anything/, /tag/x/, /feed/.
  Expect:
   - No broken links.
   - Old addresses permanently redirect (308) to /faq, /book, /about#captain, /tours/late-afternoon-private, /tours/morning-shared, /cancellation-policy, /terms#liability, /tours#private, /about#area, /news/an-unforgettable-experience, /tours, /news, /news.

[CUS-51] Search engines: staging hidden, live site visible  (before launch)
  Do:
   1. On the staging address, check the X-Robots-Tag header and /robots.txt.
   2. On crystalrivermanateefun.com (once launched), check the same, plus /sitemap.xml.
   3. Run the home page, a tour page, /faq and a news post through Google's Rich Results Test.
  Expect:
   - Staging: header "X-Robots-Tag: noindex, nofollow" and robots.txt "Disallow: /".
   - Live: no X-Robots-Tag header; robots.txt allows / and lists the sitemap; every sitemap URL returns 200; /book, /admin, /my-booking are not in it.
   - Structured data validates with no errors.

[CUS-52] Phone layout, speed and accessibility  (before launch)
  Do:
   1. Open every public page at 390 px wide.
   2. Run Lighthouse (mobile) on Home, /tours, /tours/morning-shared, /faq, /book.
   3. Record browser console errors on each page.
  Expect:
   - Nothing scrolls sideways, overlaps or gets cut off.
   - Lighthouse 90+ for Performance, Accessibility, Best Practices and SEO (list any below).
   - No console errors.

[CUS-53] Booking links can't be guessed or tampered with  (before launch)
  Note: Uses this test booking link: {BOOKING_LINK}.
  Do:
   1. Using a test booking link from Trav: remove the ?t=… part, then change one character of it, on /book/confirmation/…, /my-booking/… and …/calendar.ics.
   2. Open /tours/not-a-tour and /news/not-a-post.
   3. Open /book?date=2026-11-31, /book?guests=9, a date 366 days out, and /book/2026-12-20.
  Expect:
   - No booking details are ever shown: "Couldn't open your booking" / "Something's off" / an error for the .ics.
   - Unknown tours and posts show "Page not found — The springs don't go that way."
   - Impossible date ignored; guests snaps to 6; 366 days out not selectable; /book/2026-12-20 redirects to /book?date=2026-12-20.

[CUS-54] Contact form validation and spam protection
  Do:
   1. Submit with empty fields, a bad email, and a 5-character message.
   2. Submit one real message starting "GROKBOT TEST — please ignore".
   3. Submit once with the hidden "Leave blank" field filled in.
  Expect:
   - "Please enter your name", "Please enter a valid email", "Tell us a little more — at least 10 characters"; fields keep what was typed.
   - Real message: "Message sent".
   - Hidden field filled: shows a thank-you but nothing reaches Trav's inbox or admin Messages.

[CRW-4] Wrong password, and small typing slips  (before launch)
  Note: Uses the test crew login: {CREW_LOGIN}.
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. Sign in with a wrong password.
   2. Sign in with the email in capitals and the password pasted with a space before and after.
  Expect:
   - "That email and password don't match. Check the text from Travis, or ask Travis to reset it. Too many wrong tries pauses sign-in for 15 minutes."
   - Capitals and stray spaces still sign in.

[CRW-5] Too many wrong passwords locks the account for 15 minutes
  Note: Uses the test crew login: {CREW_LOGIN}.
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. With a TEST crew account only: enter a wrong password 10 times, then the right one.
   2. Then in Admin → Crew, reset that person's password and sign in with the new one.
  Expect:
   - The right password is refused after 10 wrong ones, with the same message as a wrong password.
   - After the admin reset, the new password works straight away.

[CRW-7] Times stay in Crystal River time
  Note: Uses the test crew login: {CREW_LOGIN}.
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. Set the phone's time zone to Pacific and reopen the crew app.
  Expect:
   - Times and Today/Tomorrow are unchanged.

[CRW-11] Crew can't get into the admin  (before launch)
  Note: Uses the test crew login: {CREW_LOGIN}.
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. While signed into the crew app (in Safari), go to /admin and /admin/bookings.
  Expect:
   - Lands on the admin Google sign-in page. No booking data shows.

[CRW-20] Crew and admin back-ends refuse anyone not signed in  (before launch)
  Do:
   1. With no cookies, send POST requests to /api/crew/push, /api/crew/push/test and /api/crew/photos.
   2. With no login, POST to an admin function such as https://us-central1-crmf-99aad.cloudfunctions.net/adminAddNote with an empty JSON body.
   3. Open /crew and /admin/bookings with no cookies.
  Expect:
   - Crew API: 401 {"error":"Signed out"}.
   - Admin function: 401 "Missing Bearer token" (or "Invalid or expired token" with a junk token).
   - Pages redirect to /crew/login and /admin/login.

[ADM-3] Admin pages are locked when signed out  (before launch)
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. In a private window, open /admin/bookings.
   2. Sign out of admin, then press Back and refresh.
  Expect:
   - Both land on the sign-in page. No booking data shows.

[NEW-2] New "18 or older" checkout box  (before launch)
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. On the booking details step, leave "I'm 18 or older and agree to the Terms of Service…" unticked and tap Pay. Then tick it and open both links in it.
  Expect:
   - Unticked: "Please confirm you're 18 or older and agree to the terms." and no checkout.
   - Ticked: checkout opens. The Terms of Service and Privacy Policy links open in a new tab.

[NEW-3] Wording fixes are live everywhere  (before launch)
  Do:
   1. Search every public page and news post for: "99%", "endangered", "touch".
   2. Open /reviews and /faq, and read the footer.
  Expect:
   - No "99%" claim anywhere. News posts call manatees "threatened", never "endangered".
   - The FAQ answer about touching manatees starts with "No."
   - /reviews says "A selection of what guests have said, picked by Travis." and shows no average rating.
   - The footer names "Crystal River Manatee Fun LLC".

[NEW-14] The MCP address refuses anyone without the key  (before launch)
  Do:
   1. Send a POST with body {} to /api/mcp on the site with no key, then with ?key=wrong, then with the header "Authorization: Bearer wrong".
   2. Send a GET to /api/mcp.
  Expect:
   - Each POST returns 401 "Unauthorized." (or 503 "The MCP endpoint isn't set up on this site yet." if setup isn't finished). No booking data ever appears.
   - GET returns 405 "Method not allowed."

[NEW-22] Wetsuit sizes from booking to boat  (before launch)
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. Book with a size for each guest (one Adult size, one Kids size).
   2. Admin → Settings: remove one size from the wetsuit list and save. Start another booking.
  Expect:
   - Sizes show on the admin booking page, in "Edit guests or contact details", on the passenger list PDF and in the confirmation email.
   - The removed size no longer appears at checkout.

[NEW-27] Private feedback form
  Note: steps that need Trav's admin account or a physical phone: mark Skipped.
  Do:
   1. From a review-request email, open the private feedback link (/feedback/…) and send a short message.
  Expect:
   - A thank-you shows, and Trav gets the feedback by email right away.

[NEW-32] Arrival and photography wording
  Do:
   1. Search every public page and the booking pages for "15 minutes".
   2. Open /terms#photography.
  Expect:
   - Arrival always says 20 to 30 minutes early and the Pete's Pier parking lot; "15 minutes" appears nowhere.
   - The photography terms name TikTok and Google and describe the shared guest gallery.

[WVR-5] Broken or early waiver links
  Do:
   1. Open a waiver link with part of the key removed. Open one for a booking still in checkout.
  Expect:
   - "This waiver link doesn't work" and "This booking isn't confirmed yet". No booking details shown.

```
