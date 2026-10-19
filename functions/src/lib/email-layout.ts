/**
 * The website's look, for email. Emails can't read the site's CSS, so the
 * palette and type below copy the @theme tokens in src/app/globals.css:
 * keep the two in step. Every email in ./email-templates.ts (and the
 * contact-form alert) builds its HTML from these pieces.
 *
 * Inline styles only, and nothing a mail client is likely to drop that the
 * layout depends on. Archivo loads where the client allows web fonts (Apple
 * Mail, iOS); elsewhere it falls back to the system sans.
 */

export const COLORS = {
  ink: '#0E201E',
  inkSoft: '#4B5D59',
  paper: '#F4F2EC',
  sand: '#E6E1D5',
  mist: '#E2EDE9',
  spring: '#16625A',
  buoy: '#F26A21',
  error: '#B3261E',
  white: '#FFFFFF',
} as const;

const SANS = "Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
/** `.text-display`: Archivo stretched wide, extra bold, tight. */
const DISPLAY = `font-family:${SANS};font-weight:800;font-stretch:116%;letter-spacing:-0.03em;`;
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..900&display=swap';

export function escape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `tel:` link for a US number shown as 352-586-7792. */
export function telHref(phoneDisplay: string): string {
  return `tel:+1${phoneDisplay.replace(/[^0-9]/g, '')}`;
}

export interface PageFooter {
  marina: { name: string; address: string };
  phoneDisplay: string;
}

/**
 * The whole email: the logo's wordmark, then `body`, then the business's
 * name, marina and phone. `preheader` is the line inboxes show after the
 * subject. Emails to Travis pass no footer.
 */
export function emailPage(opts: { title: string; preheader?: string; body: string; footer?: PageFooter }): string {
  const { title, preheader, body, footer } = opts;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <meta name="color-scheme" content="light"/>
    <meta name="supported-color-schemes" content="light"/>
    <title>${escape(title)}</title>
    <link rel="stylesheet" href="${FONTS_CSS}"/>
  </head>
  <body style="margin:0;padding:0;background:${COLORS.paper};color:${COLORS.ink};font-family:${SANS};-webkit-font-smoothing:antialiased;">
    ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escape(preheader)}</div>` : ''}
    <div style="max-width:600px;margin:0 auto;padding:28px 20px 40px;">
      <div style="padding:0 0 20px;margin:0 0 28px;border-bottom:1px solid ${COLORS.sand};">
        <div style="font-size:10px;line-height:1;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:${COLORS.spring};">Crystal River</div>
        <div style="margin-top:5px;font-size:21px;line-height:1;color:${COLORS.ink};${DISPLAY}letter-spacing:-0.02em;">Manatee Fun</div>
      </div>
      ${body}
      ${footer ? pageFooter(footer) : ''}
    </div>
  </body>
</html>`;
}

function pageFooter({ marina, phoneDisplay }: PageFooter): string {
  return `<div style="margin-top:36px;padding-top:18px;border-top:1px solid ${COLORS.sand};font-size:12px;line-height:1.6;color:${COLORS.inkSoft};">
        Crystal River Manatee Fun · ${escape(marina.name)}, ${escape(marina.address)}<br/>
        <a href="${escape(telHref(phoneDisplay))}" style="color:${COLORS.inkSoft};">${escape(phoneDisplay)}</a>
      </div>`;
}

/** The page headline. */
export function heading(text: string): string {
  return `<h1 style="margin:0 0 14px;font-size:32px;line-height:1.02;color:${COLORS.ink};${DISPLAY}">${escape(text)}</h1>`;
}

/** A section heading inside the email. */
export function subheading(text: string, opts: { margin?: string } = {}): string {
  return `<h2 style="margin:${opts.margin ?? '28px 0 10px'};font-family:${SANS};font-size:18px;line-height:1.25;font-weight:700;letter-spacing:-0.015em;color:${COLORS.ink};">${escape(text)}</h2>`;
}

/** A paragraph of trusted HTML (escape anything a customer typed first). */
export function para(html: string, opts: { soft?: boolean; small?: boolean; large?: boolean; margin?: string } = {}): string {
  const size = opts.large ? '17px' : opts.small ? '14px' : '16px';
  const color = opts.soft ? COLORS.inkSoft : COLORS.ink;
  return `<p style="margin:${opts.margin ?? '0 0 16px'};font-size:${size};line-height:1.6;color:${color};">${html}</p>`;
}

export function link(href: string, text: string): string {
  return `<a href="${escape(href)}" style="color:${COLORS.spring};text-decoration:underline;">${escape(text)}</a>`;
}

/** Orange call to action with ink type, like the site's buttons. */
export function button(href: string, label: string, opts: { secondary?: boolean } = {}): string {
  const look = opts.secondary
    ? `background:${COLORS.white};color:${COLORS.ink};border:1px solid rgba(14,32,30,0.2);`
    : `background:${COLORS.buoy};color:${COLORS.ink};border:1px solid ${COLORS.buoy};`;
  return `<a href="${escape(href)}" style="display:inline-block;${look}text-decoration:none;font-family:${SANS};font-size:16px;line-height:1.2;font-weight:600;padding:14px 22px;border-radius:10px;">${escape(label)}</a>`;
}

/** One or more buttons with room around them. */
export function actions(...buttons: string[]): string {
  return `<div style="margin:22px 0 8px;">${buttons.join('<span style="display:inline-block;width:10px;"></span>')}</div>`;
}

/** White card with a sand edge, like the site's panels. `table` for a {@link details} card. */
export function card(html: string, opts: { table?: boolean } = {}): string {
  const padding = opts.table ? '6px 22px' : '20px 22px';
  return `<div style="background:${COLORS.white};border:1px solid ${COLORS.sand};border-radius:20px;padding:${padding};margin:0 0 20px;">${html}</div>`;
}

/** Pale spring-green panel for the thing to act on. */
export function notice(html: string): string {
  return `<div style="background:${COLORS.mist};border:1px solid rgba(22,98,90,0.3);border-radius:20px;padding:20px 22px;margin:0 0 20px;">${html}</div>`;
}

/**
 * Label / value rows with hairlines between, for a card. Values are trusted
 * HTML; labels are plain text.
 */
export function details(rows: Array<[label: string, valueHtml: string] | null | false>): string {
  const shown = rows.filter((r): r is [string, string] => !!r);
  return `<table role="presentation" style="width:100%;border-collapse:collapse;">${shown
    .map(
      ([label, value], i) => `<tr>
          <td style="padding:13px 12px 13px 0;vertical-align:top;width:112px;${i ? `border-top:1px solid ${COLORS.sand};` : ''}font-size:12px;line-height:1.5;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${COLORS.inkSoft};">${escape(label)}</td>
          <td style="padding:12px 0;vertical-align:top;${i ? `border-top:1px solid ${COLORS.sand};` : ''}font-size:15px;line-height:1.5;color:${COLORS.ink};">${value}</td>
        </tr>`,
    )
    .join('')}</table>`;
}

/** The small uppercase label above a figure or list. */
export function label(text: string): string {
  return `<p style="margin:0 0 6px;font-size:12px;line-height:1.4;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${COLORS.inkSoft};">${escape(text)}</p>`;
}

/** A large figure, e.g. a refund amount. */
export function figure(text: string, opts: { muted?: boolean } = {}): string {
  return `<p style="margin:0;font-size:34px;line-height:1.05;color:${opts.muted ? COLORS.inkSoft : COLORS.spring};${DISPLAY}">${escape(text)}</p>`;
}

/** Bulleted list of trusted HTML items. */
export function list(items: string[], opts: { ordered?: boolean; margin?: string } = {}): string {
  const tag = opts.ordered ? 'ol' : 'ul';
  return `<${tag} style="margin:${opts.margin ?? '0 0 16px'};padding-left:22px;font-size:16px;line-height:1.6;color:${COLORS.ink};">${items
    .map((i) => `<li style="margin:0 0 4px;">${i}</li>`)
    .join('')}</${tag}>`;
}

/** "See you on the water, / Capt. Travis Urbin", or just the name. */
export function signoff(greeting?: string): string {
  return `<p style="margin:28px 0 0;font-size:15px;line-height:1.6;color:${COLORS.ink};">${greeting ? `${escape(greeting)}<br/>` : ''}<strong>Capt. Travis Urbin</strong></p>`;
}
