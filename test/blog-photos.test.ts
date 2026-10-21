/**
 * Which Drive photos the blog offers and takes (listBlogPhotos and
 * getBlogPhoto in src/lib/blog-photos.ts), against a stand-in for Drive and
 * an in-memory Firestore: everything in the trip folders except the copies
 * Trip photos withdrew (photos Travis deleted whose Drive copy stayed). And
 * that a post already holding such a photo doesn't go on the website
 * (hasWithdrawnPhoto and reviewPost in src/lib/blog-publish.ts), and that
 * one taken off the website loses its own copy of it
 * (deleteWithdrawnCopies).
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

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
/** Whether a document passes one `where` filter. Like Firestore, `in` and `array-contains-any` take at most 30 values. */
function matches(d: Doc, f: string, op: string, v: unknown): boolean {
  if (op === 'in' || op === 'array-contains-any') {
    if ((v as unknown[]).length > 30) throw new Error(`'${op}' takes at most 30 values`);
  }
  if (op === 'in') return (v as unknown[]).includes(field(d, f));
  if (op === 'array-contains-any') return ((field(d, f) as unknown[] | undefined) ?? []).some((x) => (v as unknown[]).includes(x));
  return field(d, f) === v;
}
/** Each document update, as it was asked for: `[path, data]`. */
const updates: Array<[string, Doc]> = [];
/** A collection's documents, with chained filters; ordering and limits are ignored. */
function collection(name: string) {
  const query = (keep: (path: string) => boolean): unknown => ({
    doc: (id: string) => ({
      get: async () => snapshot(`${name}/${id}`),
      update: async (data: Doc) => void updates.push([`${name}/${id}`, data]),
    }),
    select: () => query(keep),
    orderBy: () => query(keep),
    limit: () => query(keep),
    startAfter: () => query(() => false),
    where: (f: string, op: string, v: unknown) => query((p) => keep(p) && matches(store[p]!, f, op, v)),
    get: async () => {
      const docs = Object.keys(store)
        .filter((p) => p.startsWith(`${name}/`) && !p.slice(name.length + 1).includes('/') && keep(p))
        .map(snapshot);
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  return query(() => true);
}
// Only reads go through a transaction here: a test that gets as far as a write fails.
const runTransaction = async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    get: (ref: { get(): Promise<unknown> }) => ref.get(),
    update: () => assert.fail('nothing should be written'),
  });
/** Storage files deleted. */
const deletedFiles: string[] = [];
const bucket = { file: (path: string) => ({ delete: async () => void deletedFiles.push(path) }) };
stub('../src/lib/firebase/admin', { adminDb: () => ({ collection, runTransaction }), adminStorage: () => ({ bucket: () => bucket }) });

const { listBlogPhotos, getBlogPhoto } = load('../src/lib/blog-photos') as typeof import('../src/lib/blog-photos');
const { deleteWithdrawnCopies, hasWithdrawnPhoto, reviewPost } = load('../src/lib/blog-publish') as typeof import('../src/lib/blog-publish');

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

// setPostStatus (putting a hidden post back) asks hasWithdrawnPhoto the same question.
test('a draft holding a photo Trip photos withdrew since isn’t approved', async () => {
  assert.equal(await hasWithdrawnPhoto([]), false);
  assert.equal(await hasWithdrawnPhoto(['NEWLIVE0000001', 'OLDPHOTO000001']), false);
  assert.equal(await hasWithdrawnPhoto(['NEWLIVE0000001', 'NEWDELETED0001']), true);
  // From any trip, however old, and past the first 30 ids.
  const many = Array.from({ length: 40 }, (_, i) => `UNUSED${String(i).padStart(8, '0')}`);
  assert.equal(await hasWithdrawnPhoto([...many, 'EMPTIED000001']), true);

  // A draft submitted before Travis deleted its hero in Trip photos.
  const submittedAt = Timestamp.fromMillis(Date.parse('2026-10-16T12:00:00Z'));
  store['newsPosts/kings-bay-mornings'] = {
    title: 'Kings Bay mornings',
    status: 'pending-review',
    submittedAt,
    photoIds: ['NEWDELETED0001', 'NEWLIVE0000001'],
  };
  const approved = await reviewPost('kings-bay-mornings', submittedAt.toMillis(), 'approve', {
    email: 'travis@example.com',
    method: 'email link',
  });
  assert.equal(approved.ok, false);
  assert.match(!approved.ok ? approved.error : '', /deleted from Trip photos.*Decline it/);
  assert.equal(store['newsPosts/kings-bay-mornings']!.status, 'pending-review');
  delete store['newsPosts/kings-bay-mornings'];
});

test('a post taken off the website loses its own copy of a photo Trip photos withdrew; its other photos and live posts stay', async () => {
  const at = (slug: string, name: string) => ({ url: `https://x/${name}`, storagePath: `public/news/${slug}/a1b2/${name}.jpg`, width: 1, height: 1, alt: '' });
  const post = (slug: string, status: string) => ({
    title: slug,
    status,
    photoIds: ['NEWLIVE0000001', 'NEWDELETED0001'],
    hero: at(slug, 'hero-16x9'),
    heroCrops: [at(slug, 'hero-4x3'), at(slug, 'hero-1x1')],
    images: [at(slug, 'body-1')],
  });
  store['newsPosts/taken-down'] = post('taken-down', 'hidden');
  store['newsPosts/still-live'] = post('still-live', 'published');
  deletedFiles.length = 0;
  updates.length = 0;

  assert.equal(await deleteWithdrawnCopies('taken-down'), 1);
  // The body photo Travis deleted in Trip photos; not the hero, which is still in the gallery.
  assert.deepEqual(deletedFiles, ['public/news/taken-down/a1b2/body-1.jpg']);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]![0], 'newsPosts/taken-down');
  assert.ok((updates[0]![1].removedImagePaths as FieldValue).isEqual(FieldValue.arrayUnion('public/news/taken-down/a1b2/body-1.jpg')));

  // Recorded as gone: nothing to do a second time.
  store['newsPosts/taken-down']!.removedImagePaths = ['public/news/taken-down/a1b2/body-1.jpg'];
  assert.equal(await deleteWithdrawnCopies('taken-down'), 0);
  // A live post is never broken on the website: Trip photos tells Travis to take it down first.
  assert.equal(await deleteWithdrawnCopies('still-live'), 0);
  assert.deepEqual(deletedFiles, ['public/news/taken-down/a1b2/body-1.jpg']);
  delete store['newsPosts/taken-down'];
  delete store['newsPosts/still-live'];
});
