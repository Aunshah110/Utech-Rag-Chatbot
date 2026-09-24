// scripts/clean.ts
// Stage 2 of the RAG ingestion pipeline: raw HTML -> structured clean text.

import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { z } from 'zod';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { CleanedPage, ContentBlock, ContentBlockType, Heading, RawPage } from '../lib/types';
import { createLogger } from '../lib/utils/logger';
import { CleanError, ConfigValidationError } from '../lib/utils/errors';


const log = createLogger('clean');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CleanConfigSchema = z.object({
  inputDir: z.string().min(1).default('data/raw'),
  outputDir: z.string().min(1).default('data/cleaned'),
  minContentLength: z.number().int().min(0).default(400),
});

export type CleanConfig = z.infer<typeof CleanConfigSchema>;
export type CleanConfigInput = z.input<typeof CleanConfigSchema>;

function resolveConfig(input: CleanConfigInput): CleanConfig {
  const result = CleanConfigSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigValidationError(`Invalid CleanConfig: ${result.error.message}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const RawPageSchema = z.object({
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

// Tags that are ALWAYS removed — never contain page content
const HARD_STRIP_TAGS = [
  'script', 'style', 'noscript', 'svg', 'iframe', 'form', 'button',
  'input', 'select', 'textarea', 'link', 'meta',
];

// Structural tags — typically nav/footer chrome
const STRUCTURAL_STRIP_TAGS = ['nav', 'header', 'footer', 'aside'];

// Keyword-based removal — must be applied selectively (see stripBoilerplate)
// REMOVED: 'modal', 'menu-item' (too broad; they wrap real content on this site)
const BOILERPLATE_KEYWORDS = [
  'cookie-consent', 'cookie-banner', 'gdpr',
  'advert', 'advertisement', 'sidebar-widget',
  'breadcrumb', 'social-share', 'social-links',
  'newsletter-signup', 'popup-overlay',
  'pagination', 'related-posts', 'comment-form',
  'search-form', 'skip-link',
];

/**
 * Strips boilerplate while preserving content.
 *
 * Strategy:
 *  1. Hard-strip non-content tags (script, style, etc.).
 *  2. Hard-strip structural tags (nav, header, footer, aside).
 *  3. For each element matching a boilerplate keyword, only remove it if
 *     its text content is SMALL relative to the page — real content often
 *     hides inside divs named ".modal-open" or ".menu-item" on WordPress.
 */
function stripBoilerplate($: cheerio.CheerioAPI): void {
  // Step 1: always-remove tags
  $(HARD_STRIP_TAGS.join(',')).remove();

  // Step 2: structural tags (nav/header/footer/aside)
  $(STRUCTURAL_STRIP_TAGS.join(',')).remove();

  // Step 3: measure remaining text to calibrate keyword-based removal
  const bodyTextLength = $('body').text().replace(/\s+/g, ' ').trim().length;
  const contentThreshold = bodyTextLength * 0.25; // 25% of page = "too big to be chrome"

  // Step 4: keyword-based removal with content guard
  for (const kw of BOILERPLATE_KEYWORDS) {
    $(`[class*="${kw}" i],[id*="${kw}" i]`).each((_, el) => {
      const $el = $(el);

      // Skip if we've already removed a parent
      if ($el.parents('body').length === 0) return;

      const elText = $el.text().replace(/\s+/g, ' ').trim();
      const paragraphCount = $el.find('p').length;
      const headingCount = $el.find('h1,h2,h3,h4,h5,h6').length;

      // Guard: if element is large OR contains substantial structure,
      // assume it holds real content and skip removal
      const looksLikeContent =
        elText.length > contentThreshold ||
        paragraphCount >= 3 ||
        headingCount >= 2;

      if (looksLikeContent) {
        log.debug('Skipping keyword removal — element looks like content', {
          keyword: kw,
          elTextLength: elText.length,
          paragraphCount,
          headingCount,
        });
        return;
      }

      $el.remove();
    });
  }
}

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .replace(/ *\n */g, '\n')
    .trim();
}

function normalizeInline(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Structural extraction
// ---------------------------------------------------------------------------

const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6';
const CONTENT_SELECTOR = 'p,ul,ol,table';
const BLOCK_SELECTOR = `${HEADING_SELECTOR},${CONTENT_SELECTOR}`;

/**
 * Serializes a <table> element into a readable, header-aware text block.
 * Format:
 *   Columns: Deadline | Fee | Notes
 *   Row: March 15 | 5000 | merit-based
 */
function serializeTable($: cheerio.CheerioAPI, table: Element): string {
  const $table = $(table);

  // Try to read header row
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
      // Skip the header row we already captured
      const rowText = cells.join(' | ');
      if (headers.length > 0 && rowText === headers.join(' | ')) return;
      lines.push(`Row: ${rowText}`);
    }
  });

  return lines.join('\n');
}

function serializeList($: cheerio.CheerioAPI, list: Element): string {
  const items = $(list)
    .find('> li')
    .map((_, li) => normalizeInline($(li).text()))
    .get()
    .filter(Boolean);
  return items.map((item) => `- ${item}`).join('\n');
}

/**
 * Heuristic: does the page look like an FAQ?
 * Detects on the title or first H1/H2.
 */
function isFaqPage($: cheerio.CheerioAPI): boolean {
  const titleText = ($('title').first().text() || '').toLowerCase();
  const firstHeading = ($('h1, h2').first().text() || '').toLowerCase();
  const combined = `${titleText} ${firstHeading}`;
  return /faq|frequently\s+asked/.test(combined);
}

function extractStructure($: cheerio.CheerioAPI): {
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
    // Skip elements nested inside a heading, table, or list — those are
    // captured by the parent. Do NOT skip <p> inside another <p> (invalid HTML,
    // but common); do NOT skip <p> inside a <div> (that's normal structure).
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
// Hashing / de-duplication
// ---------------------------------------------------------------------------

/**
 * Hash is computed on the NORMALIZED content so whitespace-only differences
 * between pages are correctly detected as duplicates.
 */
function hashNormalizedContent(blocks: ContentBlock[], title: string): string {
  // Normalize title too
  const normTitle = title.replace(/\s+/g, ' ').trim().toLowerCase();
  const combined = blocks
    .map((b) => normalizeWhitespace(b.content))
    .join('\n---\n');
  return createHash('sha256').update(`${normTitle}\n###\n${combined}`).digest('hex');
}
// ---------------------------------------------------------------------------
// Per-page cleaning
// ---------------------------------------------------------------------------

export function cleanPage(raw: RawPage, config: CleanConfig): CleanedPage | null {
  const $ = cheerio.load(raw.html);
  stripBoilerplate($);

  const { title, headings, textBlocks } = extractStructure($);

  // Normalize BEFORE checking length and hashing
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
    sourceHash: hashNormalizedContent(normalizedBlocks, title),
    depth: raw.depth,
  };
}

// ---------------------------------------------------------------------------
// Persistence
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

interface CleanManifest {
  startedAt: string;
  finishedAt: string;
  config: CleanConfig;
  pagesRead: number;
  pagesCleaned: number;
  pagesDroppedShort: number;
  pagesDroppedDuplicate: number;
  pagesDroppedError: number;
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

export async function cleanAll(input: CleanConfigInput = {}): Promise<CleanManifest> {
  const config = resolveConfig(input);
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
        log.debug('Dropping duplicate page', { url: cleaned.url });
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

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  cleanAll({
    inputDir: process.env.CLEAN_INPUT_DIR,
    outputDir: process.env.CLEAN_OUTPUT_DIR,
  })
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((err) => {
      log.error('Fatal clean error', {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    });
}