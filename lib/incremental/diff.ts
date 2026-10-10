// lib/incremental/diff.ts
import { SitemapEntry } from './sitemap';
import { StateSnapshot, UrlState } from './state';

export interface DiffResult {
  /** URLs not present in previous snapshot */
  added: SitemapEntry[];
  /** URLs whose lastmod moved (candidates for refetch) */
  changed: SitemapEntry[];
  /** URLs that vanished from sitemap (candidates for deletion) */
  removed: string[];
  /** URLs present in both, with unchanged lastmod */
  unchanged: SitemapEntry[];
}

export function diffSitemap(
  current: SitemapEntry[],
  previous: StateSnapshot
): DiffResult {
  const prevUrls = new Set(Object.keys(previous.urls));
  const currentUrls = new Set(current.map((e) => e.url));

  const added: SitemapEntry[] = [];
  const changed: SitemapEntry[] = [];
  const unchanged: SitemapEntry[] = [];

  for (const entry of current) {
    const prev = previous.urls[entry.url];
    if (!prev) {
      added.push(entry);
    } else if (
      entry.lastmod &&
      prev.lastmod &&
      entry.lastmod !== prev.lastmod
    ) {
      // lastmod moved — candidate for refetch
      changed.push(entry);
    } else if (!entry.lastmod || !prev.lastmod) {
      // No lastmod on one side — can't decide by metadata alone.
      // Treat as candidate; hash verification will resolve it.
      changed.push(entry);
    } else {
      unchanged.push(entry);
    }
  }

  const removed = [...prevUrls].filter((u) => !currentUrls.has(u));

  return { added, changed, removed, unchanged };
}