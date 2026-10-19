import 'server-only';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { listBlogPhotos, previewBlogPhoto } from '@/lib/blog-photos';
import { CADENCE_DAYS, blogBrief, checkPost, publishPost, type PostInput } from '@/lib/blog-publish';
import { fail, ok } from './shared';

/*
 * The blog tools grokbot's every-other-week automation uses: read the
 * brief, choose photos, check the draft until it passes the Yoast-style
 * check, publish. See src/lib/blog-publish.ts and docs/grokbot-blog.md.
 */

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };

const postInput = {
  title: z.string().trim().min(10).max(110).describe('The headline on the page (the H1). Can be longer and friendlier than the SEO title.'),
  seoTitle: z
    .string()
    .trim()
    .max(90)
    .optional()
    .describe('The whole <title> in search results: 60 characters at most, starting with the focus keyphrase. Nothing is appended to it. Defaults to “<title> | Crystal River Manatee Fun”.'),
  slug: z.string().trim().max(80).optional().describe('The URL: /news/<slug>. Defaults to the focus keyphrase, hyphenated.'),
  metaDescription: z.string().trim().min(20).max(300).describe('120–156 characters, with the focus keyphrase once.'),
  focusKeyphrase: z.string().trim().min(3).max(80).describe('The 2–4 word search phrase this post should rank for.'),
  featuredPhoto: z
    .object({
      photoId: z.string().trim().min(1).max(120).describe('An id from list_blog_photos.'),
      alt: z.string().trim().min(1).max(200).describe('What the photo shows, 10–125 characters.'),
    })
    .describe('Heads the post and is the picture on Google and social media. Landscape, 1200px+ wide.'),
  markdown: z
    .string()
    .min(200)
    .max(40_000)
    .describe(
      'The body in plain Markdown, without the title: ## and ### headings, paragraphs, lists, [links](/tours) and photos as ![alt text](photo:<id>). No HTML.',
    ),
};

/** Like attempt() in ./shared, but Drive and Storage failures are worth reading. */
async function attemptBlog(tool: string, run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (err) {
    console.error(`MCP tool ${tool} failed`, err);
    return fail(`${tool} failed: ${err instanceof Error ? err.message : String(err)}. Try again in a few minutes; if it keeps failing, tell Travis.`);
  }
}

export function registerBlogTools(server: McpServer): void {
  server.registerTool(
    'get_blog_brief',
    {
      title: 'Blog: is a post due, and how to write it',
      description:
        `Start here. Says whether a blog post is due (one every ${CADENCE_DAYS} days; stop if not), how to write and publish one, ` +
        'the SEO and readability rules a post must pass, the pages it can link to, the posts already published (don’t repeat their topic or keyphrase), ' +
        'topic ideas for the season, and facts about the tours to stay accurate.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => attemptBlog('get_blog_brief', async () => ok(await blogBrief())),
  );

  server.registerTool(
    'list_blog_photos',
    {
      title: 'Blog: list photos from Travis’s Google Drive',
      description:
        'Photos a post can use: GoPro shots from recent trips (trip/…) and folders Travis shares with the site (library/…). ' +
        'Photos already on a post are left out unless includeUsed. Unused and newest first. Width and height are in pixels; the featured photo needs 1200+ wide.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe('Default 40.'),
        includeUsed: z.boolean().optional().describe('Also list photos already used on a post.'),
        search: z.string().trim().max(60).optional().describe('Only photos whose file or folder name contains this.'),
      },
      annotations: READ_ONLY,
    },
    ({ limit, includeUsed, search }) =>
      attemptBlog('list_blog_photos', async () => ok(await listBlogPhotos({ limit: limit ?? 40, includeUsed: includeUsed ?? false, search }))),
  );

  server.registerTool(
    'view_blog_photo',
    {
      title: 'Blog: look at a photo',
      description: 'Returns a small preview of one photo so you can judge it and write accurate alt text. Look before you choose.',
      inputSchema: { photoId: z.string().trim().min(1).max(120).describe('An id from list_blog_photos.') },
      annotations: READ_ONLY,
    },
    ({ photoId }) =>
      attemptBlog('view_blog_photo', async () => {
        const preview = await previewBlogPhoto(photoId);
        if (!preview) return fail(`No photo ${photoId}, or the site can’t open it. Use an id from list_blog_photos.`);
        return {
          content: [
            { type: 'image', data: preview.jpeg.toString('base64'), mimeType: 'image/jpeg' },
            { type: 'text', text: JSON.stringify(preview.photo, null, 2) },
          ],
        };
      }),
  );

  server.registerTool(
    'check_blog_post',
    {
      title: 'Blog: check a draft (Yoast-style)',
      description:
        'Runs the SEO and readability check on a draft without publishing it: Yoast’s checks (keyphrase placement and density, title and meta description length, links, images, ' +
        'text length, subheadings, paragraph and sentence length, Flesch reading ease, passive voice, transition words) plus ours (working links, photo size and alt text, no prices, local relevance). ' +
        'Fix every RED and as many ORANGE as you can, then check again. It also follows each outside link to make sure it loads.',
      inputSchema: postInput,
      annotations: READ_ONLY,
    },
    (input) =>
      attemptBlog('check_blog_post', async () => {
        const result = await checkPost(input as PostInput);
        return ok({
          passes: result.passes,
          seoScore: result.report.seoScore,
          readabilityScore: result.report.readabilityScore,
          slug: result.draft.slug,
          seoTitle: result.draft.seoTitle,
          stats: result.report.stats,
          report: result.summary,
        });
      }),
  );

  server.registerTool(
    'publish_blog_post',
    {
      title: 'Blog: publish a post',
      description:
        `Publishes the post at /news/<slug>, live right away, and emails Travis the link. Refused unless it passes check_blog_post, and refused within ${CADENCE_DAYS - 1} days of the last post. ` +
        'Copies the photos from Drive to the website (resized, location data removed). Send exactly the draft that passed.',
      inputSchema: postInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (input) =>
      attemptBlog('publish_blog_post', async () => {
        const result = await publishPost(input as PostInput);
        return result.ok ? ok(result) : fail(result.reason);
      }),
  );
}
