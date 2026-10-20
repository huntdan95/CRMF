import 'server-only';

/**
 * `attachment` header that keeps unusual characters in the name intact
 * (attachmentDisposition in functions/src/lib/trip-photos.ts is the same).
 */
export function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  // encodeURIComponent leaves these as they are; in `filename*` they have to be encoded.
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * A gallery file's bytes, fetched from its Storage download URL (the same
 * link the gallery shows), so the website needs no Storage permission of
 * its own. Throws if Storage doesn't return it.
 */
export async function fetchStored(url: string): Promise<Response> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`Storage returned ${res.status}`);
  return res;
}

/**
 * A name that stays one file when the zip is opened: no path separators
 * (a backslash is a folder on Windows), drive colons, control characters
 * or leading dots, so nothing lands outside the folder or hidden. The
 * Cloud Function cleans names as it records them; this covers older ones.
 */
export function zipEntryName(name: string): string {
  return name.replace(/[\\/:\p{Cc}]/gu, '_').replace(/^[.\s]+/, '') || 'photo';
}

/**
 * Names safe and unique within a zip: a second "GOPR0001.JPG" becomes
 * "GOPR0001 (2).JPG".
 */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map(zipEntryName).map((name) => {
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n === 1) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
  });
}
