import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';

/**
 * Origin allow-list, matched as regex patterns so each App Hosting rollout
 * URL doesn't need to be listed individually.
 *
 *  - Production custom domain (+ www)
 *  - Any App Hosting backend under crmf-99aad.<region>.hosted.app
 *  - Any Firebase Hosting site under <site>.web.app / .firebaseapp.com
 *  - localhost on any port (dev server, emulator UI, etc.)
 */
const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/crystalrivermanateefun\.com$/,
  /^https:\/\/www\.crystalrivermanateefun\.com$/,
  /^https:\/\/[a-z0-9-]+--crmf-99aad\.[a-z0-9-]+\.hosted\.app$/,
  /^https:\/\/crmf-99aad\.web\.app$/,
  /^https:\/\/crmf-99aad\.firebaseapp\.com$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGIN_PATTERNS.some((p) => p.test(origin));
}

export function applyCors(req: Request, res: Response): boolean {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.set('Vary', 'Origin');
  }
  // Preflight — short-circuit any further handler logic.
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

export function methodNotAllowed(res: Response, allowed: string[]) {
  res.set('Allow', allowed.join(', '));
  res.status(405).json({ error: 'Method not allowed' });
}

export function badRequest(res: Response, message: string, details?: unknown) {
  res.status(400).json({ error: message, details });
}

export function serverError(res: Response, err: unknown) {
  console.error('Function error:', err);
  const message =
    err instanceof Error ? err.message : 'Unexpected server error';
  res.status(500).json({ error: message });
}
