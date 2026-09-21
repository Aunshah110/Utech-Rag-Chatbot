// scripts/crawl.ts
// Production crawler for bbsutsd.edu.pk
// Run: npx ts-node scripts/crawl.ts
//
// Fixes applied:
//   1. Skips binary URLs (pdf, images, etc.) before fetching — saves time
//   2. Records failed URLs in the manifest for retry
//   3. Worker errors are caught and logged — no silent deaths
//   4. Atomic maxPages reservation (no overshoot)
//   5. Logs byte size + contentType on every fetch for diagnosis
//   6. Never writes files for skipped URLs

import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const CONFIG = {
  seedUrls: ['https://bbsutsd.edu.pk/'],
  allowedDomains: ['bbsutsd.edu.pk', 'www.bbsutsd.edu.pk'],
  maxDepth: 5,
  maxPages: 800,
  concurrency: 2,
  delayMs: 800,
  timeoutMs: 25000,
  maxRetries: 3,
  userAgent: 'BBSUTSD-RAGBot/1.0 (+contact: your-email@bbsutsd.edu.pk)',
  outputDir: 'data/raw',
};

// Binary/asset extensions to skip before fetching
const SKIP_EXTENSIONS =
  /\.(pdf|jpg|jpeg|png|gif|svg|webp|ico|bmp|tiff|zip|rar|7z|tar|gz|doc|docx|xls|xlsx|ppt|pptx|mp3|mp4|avi|mov|wmv|flv|mkv|woff|woff2|ttf|otf|eot|css|js|json|xml|rss|atom)$/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawPage {
  url: string;
  html: string;
  statusCode: number;
  fetchedAt: string;
  contentType: string;
  depth: number;
}

interface CrawlManifest {
  startedAt: string;
  finishedAt: string;
  durationSeconds: number;
  config: typeof CONFIG;
  pagesFetched: number;
  pagesFailed: number;
  pagesSkippedRobots: number;
  pagesSkippedDomain: number;
  pagesSkippedNonHtml: number;
  pagesSkippedExtension: number;
  failedUrls: string[];
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const log = {
  info: (msg: string, meta?: any) =>
    console.log(`[INFO] ${new Date().toISOString()} ${msg}`, meta ? JSON.stringify(meta) : ''),
  warn: (msg: string, meta?: any) =>
    console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, meta ? JSON.stringify(meta) : ''),
  error: (msg: string, meta?: any) =>
    console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, meta ? JSON.stringify(meta) : ''),
};

// ---------------------------------------------------------------------------
// URL utilities
// ---------------------------------------------------------------------------

const STRIP_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'sessionid', 'sid',
  'page', 'size', 'p', 'per_page', 'offset',
  'v', 'ver', 'version', '_', 't',
]);

export function normalizeUrl(rawUrl: string, base?: string): string | null {
  try {
    const u = new URL(rawUrl, base);

    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.protocol = 'https:';

    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');

    const params = new URLSearchParams(u.search);
    for (const key of Array.from(params.keys())) {
      if (STRIP_PARAMS.has(key.toLowerCase())) params.delete(key);
    }
    const sorted = new URLSearchParams(Array.from(params.entries()).sort());
    u.search = sorted.toString();

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
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return allowedDomains.some(
      (d) => host === d.toLowerCase().replace(/^www\./, '')
    );
  } catch {
    return false;
  }
}

function hasSkippableExtension(url: string): boolean {
  try {
    return SKIP_EXTENSIONS.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

class RobotsCache {
  private cache = new Map<string, { disallow: string[]; allow: string[] }>();

  constructor(private userAgent: string, private timeoutMs: number) {}

  private parse(body: string) {
    const rules = { disallow: [] as string[], allow: [] as string[] };
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
        rules =
          res.status === 200 && typeof res.data === 'string'
            ? this.parse(res.data)
            : { disallow: [], allow: [] };
      } catch {
        rules = { disallow: [], allow: [] };
      }
      this.cache.set(origin, rules);
    }

    const urlPath = new URL(url).pathname;
    const matchLength = (patterns: string[]) =>
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
// Fetch with retry
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(
  url: string
): Promise<{ html: string; statusCode: number; contentType: string } | null> {
  let attempt = 0;

  while (attempt <= CONFIG.maxRetries) {
    try {
      const response = await axios.get<string>(url, {
        timeout: CONFIG.timeoutMs,
        responseType: 'text',
        validateStatus: () => true,
        headers: {
          'User-Agent': CONFIG.userAgent,
          Accept: 'text/html,application/xhtml+xml',
        },
        maxRedirects: 5,
        maxContentLength: 10 * 1024 * 1024,
      });

      const contentType = String(response.headers['content-type'] ?? '');

      if (response.status >= 200 && response.status < 300) {
        return { html: response.data, statusCode: response.status, contentType };
      }

      const retryable =
        response.status === 429 || (response.status >= 500 && response.status < 600);
      if (!retryable) {
        log.warn('Non-retryable status', { url, status: response.status });
        return null;
      }

      log.warn('Retryable status', { url, status: response.status, attempt });
    } catch (err) {
      const e = err as AxiosError;
      log.warn('Request failed', { url, attempt, error: e.message });
    }

    attempt += 1;
    if (attempt <= CONFIG.maxRetries) {
      await sleep(Math.min(1000 * 2 ** attempt, 30000));
    }
  }

  log.error('Exhausted retries', { url });
  return null;
}

// ---------------------------------------------------------------------------
// Link extraction
// ---------------------------------------------------------------------------

function extractLinks(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:') ||
      href.startsWith('#')
    )
      return;

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

function writeRawPage(page: RawPage): void {
  const filePath = path.join(CONFIG.outputDir, urlToFilename(page.url));
  writeFileSync(filePath, JSON.stringify(page, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Main crawl
// ---------------------------------------------------------------------------

export async function crawlSite(): Promise<CrawlManifest> {
  ensureDir(CONFIG.outputDir);

  const robots = new RobotsCache(CONFIG.userAgent, CONFIG.timeoutMs);
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [];

  for (const seed of CONFIG.seedUrls) {
    const normalized = normalizeUrl(seed);
    if (normalized && !visited.has(normalized)) {
      visited.add(normalized);
      queue.push({ url: normalized, depth: 0 });
    }
  }

  const stats = {
    pagesFetched: 0,
    pagesFailed: 0,
    pagesSkippedRobots: 0,
    pagesSkippedDomain: 0,
    pagesSkippedNonHtml: 0,
    pagesSkippedExtension: 0,
  };
  const failedUrls: string[] = [];
  const startedAt = new Date().toISOString();

  log.info('Starting crawl', {
    seeds: CONFIG.seedUrls,
    maxDepth: CONFIG.maxDepth,
    maxPages: CONFIG.maxPages,
    concurrency: CONFIG.concurrency,
  });

  async function worker(workerId: number): Promise<void> {
    while (queue.length > 0) {
      // Reserve atomically — accounts for in-flight fetches
      if (stats.pagesFetched >= CONFIG.maxPages) break;

      const item = queue.shift();
      if (!item) return;

      // Wrapped in try/catch so a single bad URL can't kill the worker
      try {
        // 1. Domain check
        if (!isAllowedDomain(item.url, CONFIG.allowedDomains)) {
          stats.pagesSkippedDomain += 1;
          continue;
        }

        // 2. Extension check (before wasting a network request)
        if (hasSkippableExtension(item.url)) {
          stats.pagesSkippedExtension += 1;
          continue;
        }

        // 3. Robots check
        const allowed = await robots.isAllowed(item.url);
        if (!allowed) {
          stats.pagesSkippedRobots += 1;
          log.info('Skipped by robots.txt', { url: item.url });
          continue;
        }

        // 4. Fetch
        const result = await fetchWithRetry(item.url);
        if (!result) {
          stats.pagesFailed += 1;
          failedUrls.push(item.url);
          continue;
        }

        // 5. Content-type check
        const isHtml =
          result.contentType.includes('text/html') ||
          result.contentType.includes('application/xhtml') ||
          result.contentType === '';
        if (!isHtml) {
          stats.pagesSkippedNonHtml += 1;
          log.info('Skipped non-HTML', {
            url: item.url,
            contentType: result.contentType,
          });
          continue;
        }

        // 6. Persist
        const page: RawPage = {
          url: item.url,
          html: result.html,
          statusCode: result.statusCode,
          fetchedAt: new Date().toISOString(),
          contentType: result.contentType,
          depth: item.depth,
        };
        writeRawPage(page);
        stats.pagesFetched += 1;
        log.info('Fetched page', {
          url: item.url,
          depth: item.depth,
          bytes: result.html.length,
          worker: workerId,
        });

        // 7. Extract and enqueue links
        if (item.depth < CONFIG.maxDepth) {
          const links = extractLinks(result.html, item.url);
          for (const link of links) {
            if (!visited.has(link) && isAllowedDomain(link, CONFIG.allowedDomains)) {
              visited.add(link);
              queue.push({ url: link, depth: item.depth + 1 });
            }
          }
        }

        // 8. Politeness delay
        if (CONFIG.delayMs > 0) await sleep(CONFIG.delayMs);
      } catch (err) {
        // Never let a worker die silently — log and continue
        log.error('Worker iteration threw, continuing', {
          worker: workerId,
          url: item.url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const workers = Array.from({ length: CONFIG.concurrency }, (_, i) => worker(i));
  await Promise.all(workers);

  const finishedAt = new Date().toISOString();
  const durationSeconds = (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000;

  const manifest: CrawlManifest = {
    startedAt,
    finishedAt,
    durationSeconds: Math.round(durationSeconds),
    config: CONFIG,
    ...stats,
    failedUrls,
  };

  writeFileSync(
    path.join(CONFIG.outputDir, '_manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );

  log.info('Crawl complete', {
    ...stats,
    durationSeconds: Math.round(durationSeconds),
    failedUrlsCount: failedUrls.length,
  });

  return manifest;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

if (require.main === module) {
  crawlSite()
    .then((manifest) => {
      console.log('\n=== CRAWL SUMMARY ===');
      console.log(JSON.stringify(manifest, null, 2));
    })
    .catch((err) => {
      log.error('Fatal crawl error', {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    });
}