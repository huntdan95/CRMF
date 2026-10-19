/**
 * The Yoast-style post check (src/lib/seo-check.ts). Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  analyzePost,
  internalPath,
  isPassive,
  sentences,
  stem,
  summarizeReport,
  type SeoContext,
  type SeoDraft,
} from '../src/lib/seo-check';

const goodMarkdown = fs.readFileSync(path.join(__dirname, 'fixtures', 'good-post.md'), 'utf8');

const goodDraft: SeoDraft = {
  title: 'Manatee Season in Crystal River: When to Come and What to Expect',
  seoTitle: 'Manatee Season in Crystal River: When to Visit',
  slug: 'manatee-season-crystal-river',
  metaDescription:
    'Manatee season in Crystal River runs mid-November to March. See when manatees crowd Kings Bay, what the water is like and how to plan your swim.',
  focusKeyphrase: 'manatee season Crystal River',
  markdown: goodMarkdown,
  hero: { alt: 'Manatee season in Crystal River: manatees gather in a warm Kings Bay spring', width: 4000 },
};

const ctx: SeoContext = {
  internalPaths: new Set(['/', '/tours', '/book', '/faq', '/about', '/news', '/news/manatee-tours-manatee-habitat']),
  otherPosts: [
    {
      slug: 'manatee-tours-manatee-habitat',
      title: 'Manatee Tours: Manatee Habitat',
      description: 'Why manatees gather in Kings Bay near Three Sisters Springs.',
      focusKeyphrase: null,
    },
  ],
};

function rating(report: ReturnType<typeof analyzePost>, id: string) {
  const r = report.results.find((x) => x.id === id);
  assert.ok(r, `no result for ${id}`);
  return r.rating;
}

describe('analyzePost', () => {
  test('a well-built post passes, with every check green or orange', () => {
    const report = analyzePost(goodDraft, ctx);
    const reds = report.results.filter((r) => r.rating === 'problem');
    assert.deepEqual(reds, [], summarizeReport(report));
    assert.ok(report.passes, summarizeReport(report));
    assert.ok(report.stats.words >= 900, `only ${report.stats.words} words`);
    assert.equal(rating(report, 'keyphraseInIntroduction'), 'good');
    assert.equal(rating(report, 'keyphraseInTitle'), 'good');
    assert.equal(rating(report, 'keyphraseInSlug'), 'good');
    assert.equal(rating(report, 'internalLinks'), 'good');
    assert.equal(rating(report, 'outboundLinks'), 'good');
  });

  test('a keyphrase missing from the opening paragraph is red', () => {
    const markdown = goodMarkdown.replace(/^Manatee season in Crystal River is/, 'Winter is');
    const report = analyzePost({ ...goodDraft, markdown }, ctx);
    assert.equal(rating(report, 'keyphraseInIntroduction'), 'problem');
    assert.equal(report.passes, false);
  });

  test('a link to a page that does not exist is red, and so is no link to a tour', () => {
    const broken = analyzePost({ ...goodDraft, markdown: `${goodMarkdown}\n\nSee [the old page](/manatee-manners).` }, ctx);
    assert.equal(rating(broken, 'internalLinks'), 'problem');

    const noTours = goodMarkdown.replace('[our manatee tours](/tours)', 'our manatee tours').replace('[check open dates](/book)', 'check open dates');
    assert.equal(rating(analyzePost({ ...goodDraft, markdown: noTours }, ctx), 'internalLinks'), 'ok');
  });

  test('a broken outbound link is red once it has been checked', () => {
    const url = 'https://myfwc.com/wildlifehabitats/wildlife/manatee/';
    const report = analyzePost(goodDraft, {
      ...ctx,
      linkStatus: new Map([[url, { state: 'broken', detail: 'HTTP 404' }]]),
    });
    assert.equal(rating(report, 'outboundLinks'), 'problem');
  });

  test('prices, raw HTML, a body H1 and outside images are all red', () => {
    const report = analyzePost(
      {
        ...goodDraft,
        markdown: `# Big title\n\n${goodMarkdown}\n\nTours are $84 a seat.\n\n<script>alert(1)</script>\n\n![x](https://example.com/a.jpg)`,
      },
      ctx,
    );
    for (const id of ['noPrices', 'plainMarkdown', 'singleH1', 'images']) {
      assert.equal(rating(report, id), 'problem', id);
    }
  });

  test('reusing another post’s keyphrase is red; overlapping its title is orange', () => {
    const reused = analyzePost(goodDraft, {
      ...ctx,
      otherPosts: [{ slug: 'old', title: 'Old', description: 'Old.', focusKeyphrase: 'crystal river manatee seasons' }],
    });
    assert.equal(rating(reused, 'previouslyUsedKeyphrase'), 'problem');

    const habitat = analyzePost({ ...goodDraft, focusKeyphrase: 'manatee habitat' }, ctx);
    assert.equal(rating(habitat, 'previouslyUsedKeyphrase'), 'ok');
  });

  test('a short post is red, and a small featured photo is red', () => {
    const short = goodMarkdown.split('## Why Kings Bay')[0]!;
    assert.equal(rating(analyzePost({ ...goodDraft, markdown: short }, ctx), 'textLength'), 'problem');
    assert.equal(rating(analyzePost({ ...goodDraft, hero: { alt: goodDraft.hero!.alt, width: 800 } }, ctx), 'imageSize'), 'problem');
  });

  test('the keyphrase as link text is red (Yoast’s “link keyphrase”)', () => {
    const markdown = goodMarkdown.replace('[our manatee tours](/tours)', '[manatee season in Crystal River tours](/tours)');
    assert.equal(rating(analyzePost({ ...goodDraft, markdown }, ctx), 'competingLinks'), 'problem');
  });

  test('a filename as alt text is red', () => {
    const report = analyzePost({ ...goodDraft, hero: { alt: 'GOPR0123.JPG', width: 4000 } }, ctx);
    assert.equal(rating(report, 'altText'), 'problem');
  });
});

describe('text helpers', () => {
  test('sentences survive Capt., a.m. and decimals', () => {
    assert.deepEqual(sentences('Capt. Travis leaves at 8 a.m. sharp. The water is 72.5 degrees! Ready?'), [
      'Capt. Travis leaves at 8 a.m. sharp.',
      'The water is 72.5 degrees!',
      'Ready?',
    ]);
  });

  test('plurals fold to one stem', () => {
    assert.equal(stem('manatees'), stem('manatee'));
    assert.equal(stem('springs'), 'spring');
    assert.equal(stem('species'), stem('species'));
    assert.equal(stem('glass'), 'glass');
  });

  test('passive voice', () => {
    assert.equal(isPassive('Manatees are protected by federal law.'), true);
    assert.equal(isPassive('The calf was quickly spotted near the spring.'), true);
    assert.equal(isPassive('Federal law protects manatees.'), false);
    assert.equal(isPassive('We need a towel.'), false);
  });

  test('internal paths normalize hosts, slashes and fragments', () => {
    assert.equal(internalPath('/tours/morning-shared/'), '/tours/morning-shared');
    assert.equal(internalPath('https://crystalrivermanateefun.com/about#captain'), '/about');
    assert.equal(internalPath('https://www.crystalrivermanateefun.com/'), '/');
    assert.equal(internalPath('https://myfwc.com/'), null);
  });
});
