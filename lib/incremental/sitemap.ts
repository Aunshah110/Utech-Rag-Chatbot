// lib/incremental/sitemap.ts
// Renamed conceptually: now discovers URLs by crawling, since the site has no sitemap.
// File kept at the same path so imports don't change.

import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { createLogger } from '../utils/logger';

const log = createLogger('discover');

const SKIP_EXTENSIONS =
  /\.(pdf|jpg|jpeg|png|gif|svg|webp|ico|bmp|tiff|zip|rar|7z|tar|gz|doc|docx|xls|xlsx|ppt|pptx|mp3|mp4|avi|mov|wmv|flv|mkv|woff|woff2|ttf|otf|eot|css|js|json|xml|rss|atom|crdownload)$/i;

const STRIP_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'sessionid', 'sid',
  'page', 'size', 'p', 'per_page', 'offset',
  'v', 'ver', 'version', '_', 't',
]);

export interface SitemapEntry {
  url: string;
  lastmod?: string;
}

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

/**
 * Extracts all same-domain hyperlinks from an HTML page.
 */
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Discover all same-domain URLs by crawling from seed URLs.
 * Reuses the logic from scripts/crawl.ts but does NOT save page bodies —
 * only returns the URL list.
 */
export async function discoverByCrawl(
  seedUrls: string[],
  allowedDomains: string[],
  userAgent: string,
  opts: { maxDepth: number; maxPages: number; delayMs: number } = {
    maxDepth: 4,
    maxPages: 800,
    delayMs: 500,
  }
): Promise<SitemapEntry[]> {
  const queue: Array<{ url: string; depth: number }> = [];
  const visited = new Set<string>();
  const entries: SitemapEntry[] = [];

  for (const seed of seedUrls) {
    const n = normalizeUrl(seed);
    if (n && !visited.has(n)) {
      visited.add(n);
      queue.push({ url: n, depth: 0 });
    }
  }

  log.info('Starting URL discovery crawl', { seeds: seedUrls.length });

  while (queue.length > 0 && entries.length < opts.maxPages) {
    const item = queue.shift();
    if (!item) break;

    if (!isAllowedDomain(item.url, allowedDomains)) continue;
    if (hasSkippableExtension(item.url)) continue;

    try {
      const res = await axios.get<string>(item.url, {
        timeout: 20000,
        responseType: 'text',
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml',
        },
        maxRedirects: 5,
        maxContentLength: 10 * 1024 * 1024,
        validateStatus: () => true,
      });

      if (res.status !== 200) {
        log.debug('Skipping non-200', { url: item.url, status: res.status });
        await sleep(opts.delayMs);
        continue;
      }

      const contentType = String(res.headers['content-type'] ?? '');
      const isHtml =
        contentType.includes('text/html') ||
        contentType.includes('application/xhtml') ||
        contentType === '';
      if (!isHtml) {
        await sleep(opts.delayMs);
        continue;
      }

      const lastModified = res.headers['last-modified'];
      entries.push({
        url: item.url,
        lastmod: lastModified ? String(lastModified) : undefined,
      });

      log.info('Discovered', {
        url: item.url,
        depth: item.depth,
        total: entries.length,
      });

      if (item.depth < opts.maxDepth) {
        const links = extractLinks(String(res.data), item.url);
        for (const link of links) {
          if (!visited.has(link) && isAllowedDomain(link, allowedDomains)) {
            visited.add(link);
            queue.push({ url: link, depth: item.depth + 1 });
          }
        }
      }
    } catch (err) {
      log.warn('Discovery fetch failed', {
        url: item.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await sleep(opts.delayMs);
  }

  log.info('URL discovery complete', {
    discovered: entries.length,
    maxDepth: opts.maxDepth,
  });

  return entries;
}

/**
 * Legacy: kept for compatibility. Now returns empty — the site has no sitemap.
 * Calls should use discoverByCrawl instead.
 */
export async function discoverSitemaps(
  _baseUrl: string,
  _userAgent: string
): Promise<string[]> {
  log.info('Sitemap discovery skipped — site has no sitemap; using crawl fallback');
  return [];
}

/**
 * Legacy: kept for compatibility. Now returns empty.
 */
export async function fetchSitemap(
  _sitemapUrl: string,
  _userAgent: string,
  _maxDepth?: number,
  _visited?: Set<string>
): Promise<SitemapEntry[]> {
  return [];
}