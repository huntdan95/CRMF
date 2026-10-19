import 'server-only';

/**
 * The admin Cloud Functions the MCP endpoint may call. Each one accepts
 * MCP_TOKEN in place of Travis's sign-in (`requireAdmin(req, { allowMcp:
 * true })` in functions/src). Refunds and cancellations aren't here and
 * refuse the token, so they stay with the admin site.
 */
export type McpAdminFunction =
  | 'adminAddNote'
  | 'adminMarkBooking'
  | 'adminResendConfirmation'
  | 'adminEditBooking'
  | 'adminRescheduleBooking'
  | 'adminCreateBlackout'
  | 'adminDeleteBlackout'
  | 'adminUpdateTour'
  | 'adminUpsertRateSeason'
  | 'adminDeleteRateSeason'
  | 'adminUpdateContactMessage'
  | 'adminUpdateRescheduleRequest'
  | 'adminSetTripCrew';

export class AdminFunctionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AdminFunctionError';
  }
}

const TIMEOUT_MS = 30_000;

/**
 * POSTs to an admin Cloud Function with MCP_TOKEN as the bearer token. The
 * function does the validation, capacity checks, emails and audit log, the
 * same as when Travis clicks the button in admin.
 */
export async function callAdminFunction<T = { ok: true }>(
  name: McpAdminFunction,
  body: Record<string, unknown>,
): Promise<T> {
  const base = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL?.replace(/\/$/, '');
  const token = process.env.MCP_TOKEN;
  if (!base || !token) {
    throw new AdminFunctionError('The site isn’t configured to make admin changes.', 503);
  }

  let res: Response;
  try {
    res = await fetch(`${base}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    // A timeout may still have saved the change on the other end.
    throw new AdminFunctionError(
      `${name} didn’t answer. Check whether the change went through before trying again.`,
      504,
    );
  }

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new AdminFunctionError(errorMessage(parsed, res), res.status);
  }
  return parsed as T;
}

/** The function's own `{ error }` text, plus the first field problem for a 400. */
function errorMessage(parsed: unknown, res: Response): string {
  if (!parsed || typeof parsed !== 'object' || !('error' in parsed) || typeof parsed.error !== 'string') {
    return res.status === 401 || res.status === 403
      ? 'The admin functions refused the MCP token. Check MCP_TOKEN matches in App Hosting and Cloud Functions.'
      : `${res.status} ${res.statusText}`.trim();
  }
  const field = 'details' in parsed ? firstFieldError(parsed.details) : null;
  return field ? `${parsed.error}: ${field}` : parsed.error;
}

/** zod's `.format()` output: `{ field: { _errors: [...] } }`. */
function firstFieldError(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  for (const [key, value] of Object.entries(details)) {
    if (key === '_errors' || !value || typeof value !== 'object') continue;
    const errors = (value as { _errors?: unknown })._errors;
    if (Array.isArray(errors) && typeof errors[0] === 'string') return `${key} — ${errors[0]}`;
  }
  return null;
}
