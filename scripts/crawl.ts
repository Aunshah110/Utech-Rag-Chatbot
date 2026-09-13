//   crawl.ts

//  Stage 1 of the RAG ingestion pipeline: university website -> raw HTML.

import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { RawPage } from './types';
import { createLogger } from './utils/logger';
import { CrawlError, ConfigValidationError } from './utils/errors';

const log = createLogger('crawl');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CrawlConfigSchema = z.object({
    seedUrls: z.array(z.string().url()).min(1),
    allowedDomains: z.array(z.string().min(1)).min(1),
    maxDepth: z.number().int().min(0).default(3),
    maxPages: z.number().int().positive().default(500),
    concurrency: z.number().int().positive().max(20).default(4),
    delayMs: z.number().int().min(0).default(500),
    timeoutMs: z.number().int().positive().default(15000),
    maxRetries: z.number().int().min(0).default(3),
    userAgent: z.string().min(1).default('UniversityRAGBot/1.0 (+contact: your-team@example.com)'),
    outputDir: z.string().min(1).default('data/raw'),
});

export type CrawlConfig = z.infer<typeof CrawlConfigSchema>;
export type CrawlConfigInput = z.input<typeof CrawlConfigSchema>;

/** Validates and applies defaults to a user-supplied crawl config. */
function resolveConfig(input: CrawlConfigInput): CrawlConfig {
    const result = CrawlConfigSchema.safeParse(input);
    if (!result.success) {
        throw new ConfigValidationError(`Invalid CrawlConfig: ${result.error.message}`);
    }
    return result.data;
}

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

// Common tracking/session params that would otherwise cause the same page
// to be treated as many distinct URLs.
const TRACKING_PARAMS = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'sessionid', 'sid',
]);

/**
 * Normalizes a URL for de-duplication purposes: lowercases the host,
 * strips the fragment, removes tracking params, sorts remaining params,
 * and drops a trailing slash (except for the root path).
 */
export function normalizeUrl(rawUrl: string, base?: string): string | null {
    try {
        const u = new URL(rawUrl, base);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

        u.hash = '';
        u.hostname = u.hostname.toLowerCase();

        const params = new URLSearchParams(u.search);
        for (const key of Array.from(params.keys())) {
            if (TRACKING_PARAMS.has(key.toLowerCase())) params.delete(key);
        }
        const sortedParams = new URLSearchParams(Array.from(params.entries()).sort());
        u.search = sortedParams.toString();

        if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
            u.pathname = u.pathname.slice(0, -1);
        }

        return u.toString();
    } catch {
        return null;
    }
}

function isAllowedDomain(url: string, allowedDomains: string[]): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return allowedDomains.some(
            (domain) => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`)
        );
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// robots.txt compliance
// ---------------------------------------------------------------------------

interface RobotsRules {
    disallow: string[];
    allow: string[];
}

/**
 * Lightweight robots.txt cache/parser. Fetches and parses `/robots.txt`
 * once per origin, applying rules for both `*` and our own user-agent.
 * Implements simple longest-match-wins precedence, which covers the
 * overwhelming majority of real-world robots.txt files.
 */
class RobotsCache {
    private cache = new Map<string, RobotsRules>();

    constructor(private readonly userAgent: string, private readonly timeoutMs: number) { }

    private parse(body: string): RobotsRules {
        const rules: RobotsRules = { disallow: [], allow: [] };
        let applies = false;
        const targetAgent = this.userAgent.split('/')[0].toLowerCase();

        for (const rawLine of body.split('\n')) {
            const line = rawLine.replace(/#.*$/, '').trim();
            if (!line) continue;
            const [rawKey, ...rest] = line.split(':');
            const key = rawKey.trim().toLowerCase();
            const value = rest.join(':').trim();

            if (key === 'user-agent') {
                const agent = value.toLowerCase();
                applies = agent === '*' || agent === targetAgent;
            } else if (applies && key === 'disallow' && value) {
                rules.disallow.push(value);
            } else if (applies && key === 'allow' && value) {
                rules.allow.push(value);
            }
        }
        return rules;
    }

    async isAllowed(url: string): Promise<boolean> {
        const origin = new URL(url).origin;
        let rules = this.cache.get(origin);

        if (!rules) {
            try {
                const res = await axios.get<string>(`${origin}/robots.txt`, {
                    timeout: this.timeoutMs,
                    responseType: 'text',
                    validateStatus: () => true,
                    headers: { 'User-Agent': this.userAgent },
                });
                rules = res.status === 200 && typeof res.data === 'string'
                    ? this.parse(res.data)
                    : { disallow: [], allow: [] };
            } catch {
                // If robots.txt is unreachable, fail open (assume allowed) rather
                // than blocking the entire crawl on a network hiccup.
                rules = { disallow: [], allow: [] };
            }
            this.cache.set(origin, rules);
        }

        const urlPath = new URL(url).pathname;
        const matchLength = (patterns: string[]): number =>
            patterns
                .filter((p) => urlPath.startsWith(p))
                .reduce((max, p) => Math.max(max, p.length), -1);

        const disallowLen = matchLength(rules.disallow);
        const allowLen = matchLength(rules.allow);
        if (disallowLen === -1) return true;
        return allowLen >= disallowLen;
    }
}

// ---------------------------------------------------------------------------
// Fetching with retry
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number | undefined): boolean {
    if (status === undefined) return true; // network error / timeout
    return status === 429 || (status >= 500 && status < 600);
}

async function fetchWithRetry(
    url: string,
    config: CrawlConfig
): Promise<{ html: string; statusCode: number; contentType: string } | null> {
    let attempt = 0;

    while (attempt <= config.maxRetries) {
        try {
            const response = await axios.get<string>(url, {
                timeout: config.timeoutMs,
                responseType: 'text',
                validateStatus: () => true,
                headers: { 'User-Agent': config.userAgent, Accept: 'text/html,application/xhtml+xml' },
                maxRedirects: 5,
            });

            const contentType = String(response.headers['content-type'] ?? '');

            if (response.status >= 200 && response.status < 300) {
                return { html: response.data, statusCode: response.status, contentType };
            }

            if (!isRetryableStatus(response.status)) {
                log.warn('Non-retryable HTTP status, skipping', { url, status: response.status });
                return null;
            }

            log.warn('Retryable HTTP status', { url, status: response.status, attempt });
        } catch (err) {
            const axiosErr = err as AxiosError;
            log.warn('Request failed', { url, attempt, error: axiosErr.message });
        }

        attempt += 1;
        if (attempt <= config.maxRetries) {
            const backoffMs = Math.min(1000 * 2 ** attempt, 30000);
            await sleep(backoffMs);
        }
    }

    log.error('Exhausted retries, giving up on URL', { url });
    return null;
}

// ---------------------------------------------------------------------------
// Link extraction
// ---------------------------------------------------------------------------

/** Extracts and normalizes all same-origin-eligible hyperlinks from an HTML page. */
function extractLinks(html: string, pageUrl: string): string[] {
    const $ = cheerio.load(html);
    const links = new Set<string>();

    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;

        const normalized = normalizeUrl(href, pageUrl);
        if (normalized) links.add(normalized);
    });

    return Array.from(links);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function urlToFilename(url: string): string {
    return createHash('sha256').update(url).digest('hex') + '.json';
}

function writeRawPage(page: RawPage, outputDir: string): void {
    const filePath = path.join(outputDir, urlToFilename(page.url));
    writeFileSync(filePath, JSON.stringify(page, null, 2), 'utf-8');
}

interface CrawlManifest {
    startedAt: string;
    finishedAt: string;
    config: Omit<CrawlConfig, 'userAgent'>;
    pagesFetched: number;
    pagesFailed: number;
    pagesSkippedRobots: number;
    pagesSkippedDomain: number;
}

// ---------------------------------------------------------------------------
// Main crawl orchestration (BFS with bounded worker pool)
// ---------------------------------------------------------------------------

interface QueueItem {
    url: string;
    depth: number;
}

/**
 * Crawls a website starting from the configured seed URLs, following
 * same-domain links up to `maxDepth` / `maxPages`, and writes each
 * successfully fetched page to `outputDir` as a `RawPage` JSON file.
 *
 * Returns the manifest summarizing the run.
 */
export async function crawlSite(input: CrawlConfigInput): Promise<CrawlManifest> {
    const config = resolveConfig(input);
    ensureDir(config.outputDir);

    const robots = new RobotsCache(config.userAgent, config.timeoutMs);
    const visited = new Set<string>();
    const queue: QueueItem[] = [];

    for (const seed of config.seedUrls) {
        const normalized = normalizeUrl(seed);
        if (normalized && !visited.has(normalized)) {
            visited.add(normalized);
            queue.push({ url: normalized, depth: 0 });
        }
    }

    const stats = { pagesFetched: 0, pagesFailed: 0, pagesSkippedRobots: 0, pagesSkippedDomain: 0 };
    const startedAt = new Date().toISOString();

    log.info('Starting crawl', {
        seeds: config.seedUrls.length,
        maxDepth: config.maxDepth,
        maxPages: config.maxPages,
        concurrency: config.concurrency,
    });

    /** One worker: pulls URLs off the shared queue until it's empty or maxPages is hit. */
    async function worker(workerId: number): Promise<void> {
        while (queue.length > 0 && stats.pagesFetched < config.maxPages) {
            const item = queue.shift();
            if (!item) return;

            if (!isAllowedDomain(item.url, config.allowedDomains)) {
                stats.pagesSkippedDomain += 1;
                continue;
            }

            const allowed = await robots.isAllowed(item.url);
            if (!allowed) {
                stats.pagesSkippedRobots += 1;
                log.debug('Skipped by robots.txt', { url: item.url });
                continue;
            }

            const result = await fetchWithRetry(item.url, config);
            if (!result) {
                stats.pagesFailed += 1;
                continue;
            }

            const isHtml = result.contentType.includes('text/html') || result.contentType === '';
            if (!isHtml) {
                log.debug('Skipped non-HTML content', { url: item.url, contentType: result.contentType });
                continue;
            }

            const page: RawPage = {
                url: item.url,
                html: result.html,
                statusCode: result.statusCode,
                fetchedAt: new Date().toISOString(),
                contentType: result.contentType,
                depth: item.depth,
            };
            writeRawPage(page, config.outputDir);
            stats.pagesFetched += 1;
            log.info('Fetched page', { url: item.url, depth: item.depth, worker: workerId });

            if (item.depth < config.maxDepth) {
                for (const link of extractLinks(result.html, item.url)) {
                    if (!visited.has(link) && isAllowedDomain(link, config.allowedDomains)) {
                        visited.add(link);
                        queue.push({ url: link, depth: item.depth + 1 });
                    }
                }
            }

            if (config.delayMs > 0) await sleep(config.delayMs);
        }
    }

    try {
        const workers = Array.from({ length: config.concurrency }, (_, i) => worker(i));
        await Promise.all(workers);
    } catch (err) {
        throw new CrawlError('Crawl failed unexpectedly', err);
    }

    const manifest: CrawlManifest = {
        startedAt,
        finishedAt: new Date().toISOString(),
        // userAgent deliberately omitted from the manifest (not useful to persist, keeps output tidy).
        config: {
            seedUrls: config.seedUrls,
            allowedDomains: config.allowedDomains,
            maxDepth: config.maxDepth,
            maxPages: config.maxPages,
            concurrency: config.concurrency,
            delayMs: config.delayMs,
            timeoutMs: config.timeoutMs,
            maxRetries: config.maxRetries,
            outputDir: config.outputDir,
        },
        ...stats,
    };

    writeFileSync(path.join(config.outputDir, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    log.info('Crawl complete', stats);

    return manifest;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
    const seedUrls = process.env.CRAWL_SEED_URLS?.split(',').map((s) => s.trim()).filter(Boolean);
    const allowedDomains = process.env.CRAWL_ALLOWED_DOMAINS?.split(',').map((s) => s.trim()).filter(Boolean);

    if (!seedUrls?.length || !allowedDomains?.length) {
        console.error(
            'Missing config. Set CRAWL_SEED_URLS and CRAWL_ALLOWED_DOMAINS env vars, e.g.\n' +
            '  CRAWL_SEED_URLS="https://www.university.edu" CRAWL_ALLOWED_DOMAINS="university.edu" npx ts-node src/crawl.ts'
        );
        process.exit(1);
    }

    crawlSite({ seedUrls, allowedDomains })
        .then((manifest) => {
            console.log(JSON.stringify(manifest, null, 2));
        })
        .catch((err) => {
            log.error('Fatal crawl error', { error: err instanceof Error ? err.message : String(err) });
            process.exit(1);
        });
}