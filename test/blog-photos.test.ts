/**
 * Which Drive photos the blog offers and takes (listBlogPhotos and
 * getBlogPhoto in src/lib/blog-photos.ts), against a stand-in for Drive and
 * an in-memory Firestore: everything in the trip folders except the copies
 * Trip photos withdrew (photos Travis deleted whose Drive copy stayed).
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

const load = Module.createRequire(__filename);
const stub = (request: string, exports: unknown) => {
  const file = load.resolve(request);
  load.cache[file] = { id: file, filename: file, loaded: true, exports } as NodeJS.Module;
};
// `server-only` throws outside a React Server Components build: stand in for it.
stub('server-only', {});

class DriveError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const image = (id: string, folder: string) => ({
  id,
  name: `${id}.jpg`,
  mimeType: 'image/jpeg',
  createdTime: '2026-10-15T12:00:00Z',
  imageMediaMetadata: { width: 4000, height: 3000 },
  parents: [folder],
});
/**
 * Travis shared the "Manatee Fun Trip Photos" folder (ROOT) with the site:
 *  - OLD: a trip from the Drive-only uploader, with no record of each file;
 *  - NEW: one live photo, one Travis deleted whose Drive copy stayed, and one
 *    he put there himself (the site's own account can't see that one);
 *  - EMPTIED: an older trip whose photos he all deleted, one copy left.
 */
const files = Object.fromEntries(
  [
    image('OLDPHOTO000001', 'FOLDER_OLD'),
    image('NEWLIVE0000001', 'FOLDER_NEW'),
    image('NEWDELETED0001', 'FOLDER_NEW'),
    image('TRAVISOWN00001', 'FOLDER_NEW'),
    image('EMPTIED000001', 'FOLDER_EMPTIED'),
  ].map((f) => [f.id, f]),
);
const siteAccount = async () => 'site';
const serviceAccount = async () => 'service account';
stub('../src/lib/google-drive', {
  DriveError,
  isDriveConfigured: () => true,
  siteAccount,
  serviceAccount,
  serviceAccountEmail: async () => 'site@example.iam.gserviceaccount.com',
  downloadFile: async () => Buffer.alloc(0),
  downloadThumbnail: async () => Buffer.alloc(0),
  getImage: async (_who: unknown, id: string) => {
    if (!files[id]) throw new DriveError('Not found', 404);
    return files[id];
  },
  listImagesAndFolders: async (who: unknown, q: string) => {
    if (q === 'sharedWithMe = true') return { images: [], folders: [{ id: 'ROOT', name: 'Manatee Fun Trip Photos' }] };
    if (q.includes(`'ROOT'`)) {
      return { images: [], folders: ['FOLDER_OLD', 'FOLDER_NEW', 'FOLDER_EMPTIED'].map((id) => ({ id, name: id })) };
    }
    const folder = /'(\w+)' in parents/.exec(q)![1];
    // The site's own account (drive.file) sees only the files it made.
    const images = Object.values(files).filter((f) => f.parents[0] === folder && (who !== siteAccount || f.id !== 'TRAVISOWN00001'));
    return { images, folders: [] };
  },
});

type Doc = Record<string, unknown>;
const store: Record<string, Doc> = {
  'tripPhotos/2026-10-15_morning': { date: '2026-10-15', timeSlot: 'morning', folderId: 'FOLDER_OLD', photoCount: 1 },
  'tripPhotos/2026-10-22_morning': {
    date: '2026-10-22',
    timeSlot: 'morning',
    folderId: 'FOLDER_NEW',
    photoCount: 1,
    uploadToken: 'u'.repeat(32),
    withdrawnDriveIds: ['NEWDELETED0001'],
  },
  'tripPhotos/2026-09-01_morning': {
    date: '2026-09-01',
    timeSlot: 'morning',
    folderId: 'FOLDER_EMPTIED',
    photoCount: 0,
    uploadToken: 'v'.repeat(32),
    withdrawnDriveIds: ['EMPTIED000001'],
  },
};
const field = (d: Doc, path: string) => path.split('.').reduce<unknown>((v, k) => (v as Doc | undefined)?.[k], d);
const snapshot = (path: string) => ({
  id: path.split('/').pop()!,
  exists: path in store,
  data: () => store[path],
  get: (f: string) => field(store[path] ?? {}, f),
});
/** A collection's documents, with chained `==` and `in` filters; ordering and limits are ignored. */
function collection(name: string) {
  const query = (keep: (path: string) => boolean): unknown => ({
    select: () => query(keep),
    orderBy: () => query(keep),
    limit: () => query(keep),
    startAfter: () => query(() => false),
    where: (f: string, op: string, v: unknown) =>
      query((p) => keep(p) && (op === 'in' ? (v as unknown[]).includes(field(store[p]!, f)) : field(store[p]!, f) === v)),
    get: async () => {
      const docs = Object.keys(store)
        .filter((p) => p.startsWith(`${name}/`) && !p.slice(name.length + 1).includes('/') && keep(p))
        .map(snapshot);
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  return query(() => true);
}
stub('../src/lib/firebase/admin', { adminDb: () => ({ collection }), adminStorage: () => ({}) });

const { listBlogPhotos, getBlogPhoto } = load('../src/lib/blog-photos') as typeof import('../src/lib/blog-photos');

test('every photo in the trip folders but the copies Trip photos withdrew, by either id', async () => {
  const listed = await listBlogPhotos({ limit: 50, includeUsed: true });
  assert.deepEqual(listed.photos.map((p) => p.id).sort(), ['library/TRAVISOWN00001', 'trip/NEWLIVE0000001', 'trip/OLDPHOTO000001']);

  const taken = async (id: string) => !!(await getBlogPhoto(id));
  // From the old uploader, and Travis's own: never deleted, so the blog may use them.
  assert.equal(await taken('trip/OLDPHOTO000001'), true);
  assert.equal(await taken('library/OLDPHOTO000001'), true);
  assert.equal(await taken('library/TRAVISOWN00001'), true);
  assert.equal(await taken('trip/NEWLIVE0000001'), true);
  // Deleted from Trip photos, its Drive copy left behind: never, whichever id.
  assert.equal(await taken('trip/NEWDELETED0001'), false);
  assert.equal(await taken('library/NEWDELETED0001'), false);
  // Nor from a trip too old for the listing, reached through the shared folder.
  assert.equal(await taken('library/EMPTIED000001'), false);
});
