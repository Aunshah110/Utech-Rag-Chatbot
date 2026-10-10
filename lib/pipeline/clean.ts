// lib/pipeline/clean.ts
// Stage 2 of the RAG ingestion pipeline: raw HTML -> structured clean text.
// Extracted from scripts/clean.ts so it can be reused by backfill.ts.

import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { z } from 'zod';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { CleanedPage, ContentBlock, ContentBlockType, Heading, RawPage } from '../types';
import { createLogger } from '../utils/logger';
import { CleanError, ConfigValidationError } from '../utils/errors';

const log = createLogger('clean');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const CleanConfigSchema = z.object({
  inputDir: z.string().min(1).default('data/raw'),
  outputDir: z.string().min(1).default('data/cleaned'),
  minContentLength: z.number().int().min(0).default(400),
});

export type CleanConfig = z.infer<typeof CleanConfigSchema>;
export type CleanConfigInput = z.input<typeof CleanConfigSchema>;

export function resolveCleanConfig(input: CleanConfigInput): CleanConfig {
  const result = CleanConfigSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigValidationError(`Invalid CleanConfig: ${result.error.message}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export const RawPageSchema = z.object({
  url: z.string().url(),
  html: z.string(),
  statusCode: z.number(),
  fetchedAt: z.string(),
  contentType: z.string(),
  depth: z.number(),
});

// ---------------------------------------------------------------------------
// Boilerplate removal
// ---------------------------------------------------------------------------

const HARD_STRIP_TAGS = [
  'script', 'style', 'noscript', 'svg', 'iframe', 'form', 'button',
  'input', 'select', 'textarea', 'link', 'meta',
];

const STRUCTURAL_STRIP_TAGS = ['nav', 'header', 'footer', 'aside'];

const BOILERPLATE_KEYWORDS = [
  'cookie-consent', 'cookie-banner', 'gdpr',
  'advert', 'advertisement', 'sidebar-widget',
  'breadcrumb', 'social-share', 'social-links',
  'newsletter-signup', 'popup-overlay',
  'pagination', 'related-posts', 'comment-form',
  'search-form', 'skip-link',
];

export function stripBoilerplate($: cheerio.CheerioAPI): void {
  $(HARD_STRIP_TAGS.join(',')).remove();
  $(STRUCTURAL_STRIP_TAGS.join(',')).remove();

  const bodyTextLength = $('body').text().replace(/\s+/g, ' ').trim().length;
  const contentThreshold = bodyTextLength * 0.25;

  for (const kw of BOILERPLATE_KEYWORDS) {
    $(`[class*="${kw}" i],[id*="${kw}" i]`).each((_, el) => {
      const $el = $(el);
      if ($el.parents('body').length === 0) return;

      const elText = $el.text().replace(/\s+/g, ' ').trim();
      const paragraphCount = $el.find('p').length;
      const headingCount = $el.find('h1,h2,h3,h4,h5,h6').length;

      const looksLikeContent =
        elText.length > contentThreshold ||
        paragraphCount >= 3 ||
        headingCount >= 2;

      if (looksLikeContent) return;
      $el.remove();
    });
  }
}

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .replace(/ *\n */g, '\n')
    .trim();
}

export function normalizeInline(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Structural extraction
// ---------------------------------------------------------------------------

const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6';
const CONTENT_SELECTOR = 'p,ul,ol,table';
const BLOCK_SELECTOR = `${HEADING_SELECTOR},${CONTENT_SELECTOR}`;

export function serializeTable($: cheerio.CheerioAPI, table: Element): string {
  const $table = $(table);

  const headers: string[] = [];
  $table.find('tr').first().find('th').each((_, th) => {
    const t = normalizeInline($(th).text());
    if (t) headers.push(t);
  });

  const lines: string[] = [];
  if (headers.length > 0) {
    lines.push(`Columns: ${headers.join(' | ')}`);
  }

  $table.find('tr').each((_, tr) => {
    const cells = $(tr)
      .find('th,td')
      .map((__, cell) => normalizeInline($(cell).text()))
      .get()
      .filter(Boolean);
    if (cells.length > 0) {
      const rowText = cells.join(' | ');
      if (headers.length > 0 && rowText === headers.join(' | ')) return;
      lines.push(`Row: ${rowText}`);
    }
  });

  return lines.join('\n');
}

export function serializeList($: cheerio.CheerioAPI, list: Element): string {
  const items = $(list)
    .find('> li')
    .map((_, li) => normalizeInline($(li).text()))
    .get()
    .filter(Boolean);
  return items.map((item) => `- ${item}`).join('\n');
}

export function isFaqPage($: cheerio.CheerioAPI): boolean {
  const titleText = ($('title').first().text() || '').toLowerCase();
  const firstHeading = ($('h1, h2').first().text() || '').toLowerCase();
  const combined = `${titleText} ${firstHeading}`;
  return /faq|frequently\s+asked/.test(combined);
}

export function extractStructure($: cheerio.CheerioAPI): {
  title: string;
  headings: Heading[];
  textBlocks: ContentBlock[];
} {
  const headings: Heading[] = [];
  const textBlocks: ContentBlock[] = [];
  const stack: Heading[] = [];
  const faqPage = isFaqPage($);

  const candidates: Element[] = $(BLOCK_SELECTOR).toArray();

  for (const el of candidates) {
    const parents = $(el).parents(`${HEADING_SELECTOR},table,ul,ol`);
    if (parents.length > 0) continue;

    const tagName = el.tagName?.toLowerCase();
    if (!tagName) continue;

    if (/^h[1-6]$/.test(tagName)) {
      const level = Number(tagName[1]);
      const text = normalizeInline($(el).text());
      if (!text) continue;

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      const heading: Heading = { level, text };
      stack.push(heading);
      headings.push(heading);
      continue;
    }

    let content = '';
    let type: ContentBlockType;

    if (tagName === 'table') {
      type = 'table';
      content = serializeTable($, el);
    } else if (tagName === 'ul' || tagName === 'ol') {
      type = faqPage ? 'faq' : 'list';
      content = serializeList($, el);
    } else {
      type = 'paragraph';
      content = normalizeInline($(el).text());
    }

    if (!content) continue;

    textBlocks.push({
      type,
      content,
      headingPath: stack.map((h) => h.text),
    });
  }

  const titleTag = normalizeInline($('title').first().text());
  const title = titleTag || headings[0]?.text || '';

  return { title, headings, textBlocks };
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export function hashNormalizedContent(blocks: ContentBlock[]): string {
  const combined = blocks
    .map((b) => normalizeWhitespace(b.content))
    .join('\n---\n');
  return createHash('sha256').update(combined).digest('hex');
}

// ---------------------------------------------------------------------------
// Per-page cleaning — THE EXPORTED FUNCTION
// ---------------------------------------------------------------------------

export function cleanPage(raw: RawPage, config: CleanConfig): CleanedPage | null {
  const $ = cheerio.load(raw.html);
  stripBoilerplate($);

  const { title, headings, textBlocks } = extractStructure($);

  const normalizedBlocks = textBlocks.map((b) => ({
    ...b,
    content: normalizeWhitespace(b.content),
  }));

  const totalLength = normalizedBlocks.reduce((sum, b) => sum + b.content.length, 0);
  if (totalLength < config.minContentLength) {
    log.debug('Dropping page below minContentLength', { url: raw.url, totalLength });
    return null;
  }

  return {
    url: raw.url,
    title,
    headings,
    textBlocks: normalizedBlocks,
    cleanedAt: new Date().toISOString(),
    sourceHash: hashNormalizedContent(normalizedBlocks),
    depth: raw.depth,
  };
}

// ---------------------------------------------------------------------------
// Batch cleaning (for the CLI script)
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadRawPages(inputDir: string): RawPage[] {
  if (!existsSync(inputDir)) {
    throw new CleanError(`Input directory does not exist: ${inputDir}`);
  }

  const files = readdirSync(inputDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  const pages: RawPage[] = [];

  for (const file of files) {
    const filePath = path.join(inputDir, file);
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      const result = RawPageSchema.safeParse(raw);
      if (!result.success) {
        log.warn('Skipping invalid RawPage file', { file, error: result.error.message });
        continue;
      }
      pages.push(result.data);
    } catch (err) {
      log.warn('Failed to read/parse RawPage file, skipping', {
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return pages;
}

function urlToFilename(url: string): string {
  return createHash('sha256').update(url).digest('hex') + '.json';
}

export interface CleanManifest {
  startedAt: string;
  finishedAt: string;
  config: CleanConfig;
  pagesRead: number;
  pagesCleaned: number;
  pagesDroppedShort: number;
  pagesDroppedDuplicate: number;
  pagesDroppedError: number;
}

export async function cleanAll(input: CleanConfigInput = {}): Promise<CleanManifest> {
  const config = resolveCleanConfig(input);
  ensureDir(config.outputDir);

  const startedAt = new Date().toISOString();
  const rawPages = loadRawPages(config.inputDir);
  log.info('Loaded raw pages', { count: rawPages.length });

  const stats = {
    pagesCleaned: 0,
    pagesDroppedShort: 0,
    pagesDroppedDuplicate: 0,
    pagesDroppedError: 0,
  };
  const seenHashes = new Set<string>();

  for (const raw of rawPages) {
    try {
      const cleaned = cleanPage(raw, config);
      if (!cleaned) {
        stats.pagesDroppedShort += 1;
        continue;
      }

      if (seenHashes.has(cleaned.sourceHash)) {
        stats.pagesDroppedDuplicate += 1;
        continue;
      }
      seenHashes.add(cleaned.sourceHash);

      const filePath = path.join(config.outputDir, urlToFilename(cleaned.url));
      writeFileSync(filePath, JSON.stringify(cleaned, null, 2), 'utf-8');
      stats.pagesCleaned += 1;
    } catch (err) {
      stats.pagesDroppedError += 1;
      log.error('Failed to clean page', {
        url: raw.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const manifest: CleanManifest = {
    startedAt,
    finishedAt: new Date().toISOString(),
    config,
    pagesRead: rawPages.length,
    ...stats,
  };

  writeFileSync(
    path.join(config.outputDir, '_manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );
  log.info('Cleaning complete', stats);

  return manifest;
}