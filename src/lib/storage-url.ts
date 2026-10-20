/**
 * A Firebase Storage download URL: shows the file to anyone with the link,
 * no sign-in, without making the bucket public. Pass the Storage
 * emulator's `host:port` when testing locally.
 */
export function storageFileUrl(
  bucket: string,
  path: string,
  downloadToken: string,
  emulatorHost?: string,
): string {
  const origin = emulatorHost ? `http://${emulatorHost}` : 'https://firebasestorage.googleapis.com';
  return `${origin}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;
}
