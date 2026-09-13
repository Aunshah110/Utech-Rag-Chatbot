//  clean.ts

//  Stage 2 of the RAG ingestion pipeline: raw HTML -> structured clean text.

import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { z } from 'zod';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { CleanedPage, ContentBlock, Heading, RawPage } from './types';
import { createLogger } from './utils/logger';
import { CleanError, ConfigValidationError } from './utils/errors';

const log = createLogger('clean');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CleanConfigSchema = z.object({
    inputDir: z.string().min(1).default('data/raw'),
    outputDir: z.string().min(1).default('data/cleaned'),
    minContentLength: z.number().int().min(0).default(200),
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
// Input validation (boundary check on data produced by crawl.ts)
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

// Structural elements that are never page content.
const BOILERPLATE_TAGS = [
    'script', 'style', 'noscript', 'svg', 'iframe', 'form', 'button',
    'input', 'select', 'textarea', 'nav', 'header', 'footer', 'aside',
];

// class/id substrings commonly used for non-content chrome. Matched
// case-insensitively against both class and id attributes.
const BOILERPLATE_KEYWORDS = [
    'cookie', 'consent', 'gdpr', 'banner', 'advert', 'sidebar', 'breadcrumb',
    'social-share', 'social-links', 'newsletter', 'popup', 'modal', 'nav-menu',
    'site-header', 'site-footer', 'skip-link', 'pagination', 'related-posts',
    'comment-form', 'search-form',
];

function stripBoilerplate($: cheerio.CheerioAPI): void {
    $(BOILERPLATE_TAGS.join(',')).remove();

    const keywordSelector = BOILERPLATE_KEYWORDS
        .map((kw) => `[class*="${kw}" i],[id*="${kw}" i]`)
        .join(',');
    $(keywordSelector).remove();

    // HTML comments are not rendered by cheerio's .text() calls, so no
    // explicit removal step is needed for them.
}

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

/** Collapses whitespace/newlines and trims. Entity decoding is handled by cheerio's .text(). */
function normalizeWhitespace(text: string): string {
    return text.replace(/[ \t\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n').replace(/ *\n */g, '\n').trim();
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

/** Serializes a <table> element into a readable, row-delimited text block. */
function serializeTable($: cheerio.CheerioAPI, table: Element): string {
    const rows: string[] = [];
    $(table)
        .find('tr')
        .each((_, tr) => {
            const cells = $(tr)
                .find('th,td')
                .map((__, cell) => normalizeInline($(cell).text()))
                .get()
                .filter(Boolean);
            if (cells.length > 0) rows.push(cells.join(' | '));
        });
    return rows.join('\n');
}

/** Serializes a <ul>/<ol> element into a bullet-point text block. */
function serializeList($: cheerio.CheerioAPI, list: Element): string {
    const items = $(list)
        .find('> li')
        .map((_, li) => normalizeInline($(li).text()))
        .get()
        .filter(Boolean);
    return items.map((item) => `- ${item}`).join('\n');
}

function extractStructure($: cheerio.CheerioAPI): {
    title: string;
    headings: Heading[];
    textBlocks: ContentBlock[];
} {
    const headings: Heading[] = [];
    const textBlocks: ContentBlock[] = [];
    const stack: Heading[] = [];

    const candidates: Element[] = $(BLOCK_SELECTOR).toArray();

    for (const el of candidates) {
        const hasMatchedAncestor = $(el).parents(BLOCK_SELECTOR).length > 0;
        if (hasMatchedAncestor) continue;

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
        let type: ContentBlock['type'];

        if (tagName === 'table') {
            type = 'table';
            content = serializeTable($, el);
        } else if (tagName === 'ul' || tagName === 'ol') {
            type = 'list';
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

function hashContent(textBlocks: ContentBlock[]): string {
    const combined = textBlocks.map((b) => b.content).join('\n');
    return createHash('sha256').update(combined).digest('hex');
}

// ---------------------------------------------------------------------------
// Per-page cleaning
// ---------------------------------------------------------------------------

/** Cleans a single RawPage into a CleanedPage, or returns null if it should be dropped. */
export function cleanPage(raw: RawPage, config: CleanConfig): CleanedPage | null {
    const $ = cheerio.load(raw.html);
    stripBoilerplate($);

    const { title, headings, textBlocks } = extractStructure($);

    const totalLength = textBlocks.reduce((sum, b) => sum + b.content.length, 0);
    if (totalLength < config.minContentLength) {
        log.debug('Dropping page below minContentLength', { url: raw.url, totalLength });
        return null;
    }

    return {
        url: raw.url,
        title,
        headings,
        textBlocks: textBlocks.map((b) => ({ ...b, content: normalizeWhitespace(b.content) })),
        cleanedAt: new Date().toISOString(),
        sourceHash: hashContent(textBlocks),
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

    const stats = { pagesCleaned: 0, pagesDroppedShort: 0, pagesDroppedDuplicate: 0, pagesDroppedError: 0 };
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
            log.error('Failed to clean page', { url: raw.url, error: err instanceof Error ? err.message : String(err) });
        }
    }

    const manifest: CleanManifest = {
        startedAt,
        finishedAt: new Date().toISOString(),
        config,
        pagesRead: rawPages.length,
        ...stats,
    };

    writeFileSync(path.join(config.outputDir, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
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
            log.error('Fatal clean error', { error: err instanceof Error ? err.message : String(err) });
            process.exit(1);
        });
}