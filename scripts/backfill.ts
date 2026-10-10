// scripts/backfill.ts
// Weekly incremental refresh: sitemap → diff → fetch → process → save state.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env' });

import { CohereClient } from 'cohere-ai';
import { Index } from '@upstash/vector';
import { createLogger } from '../lib/utils/logger';
import { ConfigValidationError } from '../lib/utils/errors';
import { discoverByCrawl, SitemapEntry } from '../lib/incremental/sitemap';
import { loadSnapshot, saveSnapshot, saveMetadata, StateSnapshot, UrlState } from '../lib/incremental/state';
import { diffSitemap } from '../lib/incremental/diff';
import { processDelta, processRemovals } from '../lib/incremental/process';

const log = createLogger('backfill');

const BASE_URL = 'https://bbsutsd.edu.pk';
const USER_AGENT = 'BBSUTSD-RAGBot/1.0 (+contact: your-email@bbsutsd.edu.pk)';

function createCohere(): CohereClient {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) throw new ConfigValidationError('COHERE_API_KEY not set');
  return new CohereClient({ token: apiKey });
}

function createUpstash(): Index {
  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (!url || !token) throw new ConfigValidationError('Upstash env vars not set');
  return new Index({ url, token });
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const runStart = Date.now();

  log.info('Backfill run starting', { baseUrl: BASE_URL });

  // 1. Discover URLs by crawling (site has no sitemap)
const allEntries = await discoverByCrawl(
  [BASE_URL],
  ['bbsutsd.edu.pk', 'www.bbsutsd.edu.pk', 'https://www.bbsutsd.edu.pk', 'http://www.bbsutsd.edu.pk'],
  USER_AGENT,
  { maxDepth: 6, maxPages: 2000, delayMs: 500 }
);

log.info('URLs discovered', { unique: allEntries.length });

  // 2. Load previous state and diff
  const previous = loadSnapshot();
  const diff = diffSitemap(allEntries, previous);

  log.info('Diff result', {
    added: diff.added.length,
    changed: diff.changed.length,
    removed: diff.removed.length,
    unchanged: diff.unchanged.length,
  });

  if (diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0) {
    log.info('No changes detected — backfill complete');
    saveMetadata({
      startedAt,
      finishedAt: new Date().toISOString(),
      pagesAdded: 0,
      pagesUpdated: 0,
      pagesRemoved: 0,
      pagesSkipped: diff.unchanged.length,
      totalUrls: allEntries.length,
    });
    return;
  }

  // 3. Process new + changed URLs
  const candidates = [...diff.added, ...diff.changed];
  const cohere = createCohere();
  const upstash = createUpstash();

  const results = await processDelta(
    candidates,
    previous.urls,
    {
      userAgent: USER_AGENT,
      cohereClient: cohere,
      upstashIndex: upstash,
      embedModel: 'embed-english-v3.0',
      chunkMaxTokens: 500,
      chunkMinTokens: 200,
      chunkOverlapTokens: 75,
      batchSize: 96,
    },
    (done, total) => {
      if (done % 10 === 0 || done === total) {
        log.info('Progress', { done, total });
      }
    }
  );

  // 4. Process removals
  const removedChunks = await processRemovals(diff.removed, upstash);

  // 5. Build new snapshot
  const newUrls: Record<string, UrlState> = {};
  const now = new Date().toISOString();

  // Carry forward unchanged URLs
  for (const entry of diff.unchanged) {
    const prev = previous.urls[entry.url];
    if (prev) newUrls[entry.url] = prev;
  }

  // Add/update from process results
  for (const result of results) {
    const entry = candidates.find((c) => c.url === result.url);
    if (!entry) continue;

    if (result.status === 'skipped') {
      const prev = previous.urls[result.url];
      if (prev) newUrls[result.url] = prev;
    } else if (result.newHash) {
      newUrls[result.url] = {
        url: result.url,
        lastmod: entry.lastmod,
        lastModified: entry.lastmod,
        contentHash: result.newHash,
        lastFetchedAt: now,
      };
    }
  }

  const newSnapshot: StateSnapshot = {
    version: 1,
    generatedAt: now,
    urls: newUrls,
  };
  saveSnapshot(newSnapshot);

  // 6. Report
  const added = results.filter((r) => r.status === 'added').length;
  const updated = results.filter((r) => r.status === 'updated').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const errors = results.filter((r) => r.status === 'error').length;

  const elapsed = ((Date.now() - runStart) / 1000).toFixed(1);

  log.info('Backfill complete', {
    elapsedSeconds: elapsed,
    added,
    updated,
    skipped,
    errors,
    removedPages: diff.removed.length,
    removedChunks,
    totalIndexed: Object.keys(newUrls).length,
  });

  saveMetadata({
    startedAt,
    finishedAt: new Date().toISOString(),
    pagesAdded: added,
    pagesUpdated: updated,
    pagesRemoved: diff.removed.length,
    pagesSkipped: skipped + diff.unchanged.length,
    totalUrls: allEntries.length,
  });

  if (errors > 0) {
    log.warn('Some URLs failed — see logs above', { errors });
    process.exitCode = 1;
  }
}

main().catch((err) => {
  log.error('Fatal backfill error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});