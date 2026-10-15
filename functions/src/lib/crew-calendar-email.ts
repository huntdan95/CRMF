import {
  actions,
  button,
  card,
  emailPage,
  escape,
  heading,
  label,
  list,
  notice,
  para,
  subheading,
} from './email-layout';

/**
 * The email with a crew member's calendar link (adminSendCrewCalendarLink).
 * The link is the only key to the feed, so the email says not to pass it
 * on, and it isn't copied to Travis.
 */
export function buildCrewCalendarEmail(ctx: { name: string; httpsUrl: string; webcalUrl: string }) {
  const firstName = ctx.name.trim().split(/\s+/)[0] || 'there';
  const subject = '[CRMF] Our trips in your phone calendar';
  const lagNote =
    'Your iPhone checks for changes fairly often. Google Calendar can take hours to catch up. ' +
    'For last-minute changes, go by the crew app’s notifications and the [CRMF] emails, not the calendar.';
  const privacyNote =
    'The calendar shows times and headcounts only, no guest names. Anyone with this link can see the schedule, ' +
    'so keep it to yourself. If it gets out, ask Travis for a new one and this one stops working.';

  const text = [
    `Hi ${firstName},`,
    '',
    'Here’s a link that puts every booked Manatee Fun trip in your phone’s calendar, and keeps it up to date.',
    '',
    'iPHONE',
    `  1. On your iPhone, open this link: ${ctx.webcalUrl}`,
    '  2. Tap Subscribe, then Add.',
    '',
    'GOOGLE CALENDAR',
    '  1. On a computer, go to calendar.google.com.',
    '  2. Next to "Other calendars", click + and then "From URL".',
    `  3. Paste this link and click "Add calendar": ${ctx.httpsUrl}`,
    '  It then shows up in the Google Calendar app on your phone.',
    '',
    lagNote,
    '',
    privacyNote,
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: 'Every booked trip in your phone’s calendar, kept up to date.',
    body: [
      heading('Trips in your calendar'),
      para(
        `Hi ${escape(firstName)}. Here’s a link that puts every booked Manatee Fun trip in your phone’s calendar, and keeps it up to date.`,
        { large: true, margin: '0 0 24px' },
      ),
      notice(
        subheading('On an iPhone', { margin: '0 0 10px' }) +
          list(['Open this email on your iPhone and tap the button.', 'Tap <strong>Subscribe</strong>, then <strong>Add</strong>.'], {
            ordered: true,
          }) +
          actions(button(ctx.webcalUrl, 'Add to iPhone calendar')),
      ),
      card(
        subheading('In Google Calendar', { margin: '0 0 10px' }) +
          list(
            [
              'On a computer, go to <strong>calendar.google.com</strong>.',
              'Next to <strong>Other calendars</strong>, click <strong>+</strong> and then <strong>From URL</strong>.',
              'Paste the link below and click <strong>Add calendar</strong>.',
            ],
            { ordered: true },
          ) +
          label('Your link') +
          para(`<span style="word-break:break-all;font-family:Menlo,Consolas,monospace;font-size:13px;">${escape(ctx.httpsUrl)}</span>`, {
            margin: '0 0 12px',
          }) +
          para('It then shows up in the Google Calendar app on your phone.', { soft: true, small: true, margin: '0' }),
      ),
      para(escape(lagNote), { small: true }),
      para(escape(privacyNote), { soft: true, small: true }),
    ].join('\n'),
  });

  return { subject, text, html };
}
