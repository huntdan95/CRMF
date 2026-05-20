import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';

/** Allow-list of origins permitted to call our HTTP functions from the browser. */
const ALLOWED_ORIGINS = new Set<string>([
  'https://crystalrivermanateefun.com',
  'https://www.crystalrivermanateefun.com',
  'https://crmf--crystal-river-manatee-fun.web.app', // App Hosting preview
  'http://localhost:3000',
  'http://localhost:3001',
]);

export function applyCors(req: Request, res: Response): boolean {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Vary', 'Origin');
  }
  // Preflight
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
