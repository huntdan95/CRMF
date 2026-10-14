/**
 * One-time setup: connects the site to the Google Drive that trip photos
 * go into (see src/lib/trip-photos-server.ts).
 *
 *   npm run connect:drive -- <oauth-client-id> <oauth-client-secret>
 *
 * Opens Google's consent page in your browser. Sign in as the account whose
 * Drive should hold the photos — the one grokbot reads. The site only gets
 * the `drive.file` scope: it can see and change the files it creates, not
 * the rest of that Drive.
 *
 * Writes the refresh token to google-drive-refresh-token.local.txt
 * (gitignored) and prints the commands that store it as App Hosting
 * secrets. The README's "Crew app" section has the full setup.
 */
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { exec } from 'node:child_process';
import type { AddressInfo } from 'node:net';

const OUT_FILE = 'google-drive-refresh-token.local.txt';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const [clientId, clientSecret] = process.argv.slice(2).filter((a) => a !== '--');
if (!clientId || !clientSecret) {
  console.error('Usage: npm run connect:drive -- <oauth-client-id> <oauth-client-secret>');
  process.exit(1);
}

const state = randomBytes(16).toString('hex');
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (!code && !error) {
    res.writeHead(404).end();
    return;
  }

  const finish = (status: number, message: string) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message);
    server.close();
  };

  if (error || url.searchParams.get('state') !== state) {
    finish(400, `Google sign-in didn't complete (${error ?? 'state mismatch'}). Run the script again.`);
    console.error(`\nSign-in failed: ${error ?? 'state mismatch'}`);
    process.exitCode = 1;
    return;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });
  const tokens = (await tokenRes.json()) as { refresh_token?: string; error?: string };
  if (!tokenRes.ok || !tokens.refresh_token) {
    finish(500, 'Couldn’t get a token from Google. Check the terminal.');
    console.error('\nToken exchange failed:', tokens.error ?? tokenRes.status);
    process.exitCode = 1;
    return;
  }

  writeFileSync(OUT_FILE, tokens.refresh_token, { mode: 0o600 });
  finish(200, 'Connected. You can close this tab and go back to the terminal.');
  console.log(`
Connected. Refresh token saved to ${OUT_FILE}.

Store the three values for App Hosting (each command offers to grant the
backend access — say yes):

  firebase apphosting:secrets:set GOOGLE_DRIVE_CLIENT_SECRET
      (paste: the client secret you passed to this script)
  firebase apphosting:secrets:set GOOGLE_DRIVE_REFRESH_TOKEN --data-file ${OUT_FILE}

Then in apphosting.yaml, uncomment the GOOGLE_DRIVE_* block, set
GOOGLE_DRIVE_CLIENT_ID to:

  ${clientId}

and push to main. Delete ${OUT_FILE} once the secret is stored.
`);
});

function redirectUri(): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

server.listen(0, '127.0.0.1', () => {
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  console.log(`Opening Google sign-in. If no browser opens, visit:\n\n  ${authUrl}\n`);
  const opener =
    process.platform === 'win32'
      ? `start "" "${authUrl}"`
      : process.platform === 'darwin'
        ? `open "${authUrl}"`
        : `xdg-open "${authUrl}"`;
  exec(opener);
});
