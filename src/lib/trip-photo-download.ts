import 'server-only';
import { Readable } from 'node:stream';
import { adminStorage } from './firebase/admin';
import { storageBucketName } from './trip-photos-server';

/** `attachment` header that keeps unusual characters in the name intact. */
export function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** A stored trip file as a web stream, for a download response. */
export function storageStream(storagePath: string): ReadableStream<Uint8Array> {
  const node = adminStorage().bucket(storageBucketName()).file(storagePath).createReadStream();
  return Readable.toWeb(node) as ReadableStream<Uint8Array>;
}

/** Names unique within a zip: a second "GOPR0001.JPG" becomes "GOPR0001 (2).JPG". */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n === 1) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
  });
}
