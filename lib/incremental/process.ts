// lib/incremental/process.ts
import axios from 'axios';
import { createHash } from 'crypto';
import { CohereClient } from 'cohere-ai';
import { Index } from '@upstash/vector';
import { createLogger } from '../utils/logger';
import { SitemapEntry } from './sitemap';
import { UrlState } from './state';
import { cleanPage } from '../pipeline/clean';
import { chunkPage } from '../pipeline/chunk';
import { createTokenizer } from '../utils/tokenizer';

const log = createLogger('delta');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ProcessResult {
  url: string;
  status: 'added' | 'updated' | 'skipped' | 'error';
  newHash?: string;
  error?: string;
  chunksWritten?: number;
}

/**
 * Fetch a URL, compute its content hash, and compare against the stored hash.
 * Returns the raw HTML if changed, or null if unchanged.
 */
async function fetchAndCheck(
  url: string,
  previousHash: string | undefined,
  previousLastModified: string | undefined,
  userAgent: string
): Promise<{ html: string; hash: string; lastModified?: string } | null> {
  try {
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      Accept: 'text/html,application/xhtml+xml',
    };

    // Ask the server "has this changed since last time?"
    if (previousLastModified) {
      headers['If-Modified-Since'] = previousLastModified;
    }

    const res = await axios.get(url, {
      timeout: 20000,
      responseType: 'text',
      headers,
      maxRedirects: 5,
      maxContentLength: 10 * 1024 * 1024,
      validateStatus: () => true,
    });

    // 304 Not Modified — server confirms nothing changed. Skip.
    if (res.status === 304) {
      log.debug('304 Not Modified', { url });
      return null;
    }

    if (res.status !== 200) {
      log.warn('Non-200 response', { url, status: res.status });
      return null;
    }

    const contentType = String(res.headers['content-type'] ?? '');
    const isHtml =
      contentType.includes('text/html') ||
      contentType.includes('application/xhtml') ||
      contentType === '';
    if (!isHtml) return null;

    const html = String(res.data);
    const hash = createHash('sha256').update(html).digest('hex');

    if (previousHash && hash === previousHash) {
      return null; // Content unchanged
    }

    return {
      html,
      hash,
      lastModified: res.headers['last-modified']
        ? String(res.headers['last-modified'])
        : undefined,
    };
  } catch (err: any) {
    log.warn('Fetch failed', { url, error: err?.message ?? String(err) });
    return null;
  }
}
/**
 * Process a batch of URLs through the delta pipeline.
 * Returns per-URL results.
 */
export async function processDelta(
  candidates: SitemapEntry[],
  previousUrls: Record<string, UrlState>,
  config: {
    userAgent: string;
    cohereClient: CohereClient;
    upstashIndex: Index;
    embedModel: string;
    chunkMaxTokens: number;
    chunkMinTokens: number;
    chunkOverlapTokens: number;
    batchSize: number;
  },
  onProgress?: (done: number, total: number) => void
): Promise<ProcessResult[]> {
  const results: ProcessResult[] = [];
  const tokenizer = createTokenizer('cl100k_base');

  let done = 0;

  for (const entry of candidates) {
    const prev = previousUrls[entry.url];
    const prevHash = prev?.contentHash;

    // Stage 1: Fetch + hash check
    const fetched = await fetchAndCheck(
      entry.url,
      prev?.contentHash,
      prev?.lastModified,  // ← pass stored value
      config.userAgent
    );

    if (!fetched) {
      results.push({ url: entry.url, status: 'skipped' });
      done++;
      onProgress?.(done, candidates.length);
      await sleep(500);
      continue;
    }

    try {
      // Stage 2: Clean
      const cleaned = cleanPage(
        { url: entry.url, html: fetched.html, statusCode: 200, fetchedAt: new Date().toISOString(), contentType: 'text/html', depth: 0 },
        { inputDir: '', outputDir: '', minContentLength: 400 }
      );

      if (!cleaned || cleaned.textBlocks.length === 0) {
        results.push({ url: entry.url, status: 'error', error: 'No content after cleaning' });
        done++;
        onProgress?.(done, candidates.length);
        continue;
      }

      // Stage 3: Chunk
      const chunks = chunkPage(cleaned, {
        inputDir: '', outputDir: '',
        maxTokens: config.chunkMaxTokens,
        minTokens: config.chunkMinTokens,
        overlapTokens: config.chunkOverlapTokens,
        encodingName: 'cl100k_base',
      }, tokenizer);

      if (chunks.length === 0) {
        results.push({ url: entry.url, status: 'error', error: 'No chunks produced' });
        done++;
        onProgress?.(done, candidates.length);
        continue;
      }

      // Stage 4: Embed (batch all chunks for this page)
      const texts = chunks.map((c) => c.text);
      const embedRes = await config.cohereClient.embed({
        model: config.embedModel,
        texts,
        inputType: 'search_document',
        embeddingTypes: ['float'],
      });

      const embeddings = (embedRes as any).embeddings?.float ?? (embedRes as any).embeddings;
      if (!embeddings || embeddings.length !== chunks.length) {
        throw new Error('Embedding count mismatch');
      }

      // Stage 5: Delete old chunks for this page, then upsert new ones
      // Old chunk IDs follow the pattern: {docId}-{index}
      const docId = createHash('sha256').update(entry.url).digest('hex').slice(0, 16);
      // Delete by prefix to remove all old chunks for this doc
      try {
        await config.upstashIndex.delete({ prefix: `${docId}-` });
      } catch (delErr: any) {
        log.warn('Delete old chunks failed (may be empty)', {
          url: entry.url,
          error: delErr?.message,
        });
      }

      // Upsert new chunks in batches of 100
      const upsertBatchSize = 100;
      for (let i = 0; i < chunks.length; i += upsertBatchSize) {
        const batchChunks = chunks.slice(i, i + upsertBatchSize);
        const payload = batchChunks.map((c, j) => ({
          id: c.chunk_id,
          vector: embeddings[i + j],
          metadata: {
            doc_id: c.doc_id,
            source_url: c.source_url,
            page_title: c.page_title,
            section_heading: c.section_heading,
            heading_path: c.heading_path.join(' > '),
            content_type: c.content_type,
            token_count: c.token_count,
            chunk_index: c.chunk_index,
            chunk_count: c.chunk_count,
            crawled_at: c.crawled_at,
            language: c.language,
            source_hash: c.source_hash,
            text: c.text,
          },
        }));

        await config.upstashIndex.upsert(payload);
      }

      const isNew = !prevHash;
      results.push({
        url: entry.url,
        status: isNew ? 'added' : 'updated',
        newHash: fetched.hash,
        chunksWritten: chunks.length,
      });
    } catch (err: any) {
      log.error('Delta processing failed', {
        url: entry.url,
        error: err?.message ?? String(err),
      });
      results.push({ url: entry.url, status: 'error', error: err?.message });
    }

    done++;
    onProgress?.(done, candidates.length);

    // Politeness — 500ms between pages
    await sleep(500);
  }

  return results;
}

/**
 * Delete chunks for removed URLs from Upstash.
 */
export async function processRemovals(
  removedUrls: string[],
  upstashIndex: Index
): Promise<number> {
  let deleted = 0;

  for (const url of removedUrls) {
    const docId = createHash('sha256').update(url).digest('hex').slice(0, 16);
    try {
      const res = await upstashIndex.delete({ prefix: `${docId}-` });
      deleted += (res as any)?.deleted ?? 0;
      log.info('Deleted chunks for removed URL', { url, count: (res as any)?.deleted });
    } catch (err: any) {
      log.warn('Delete failed for removed URL', {
        url,
        error: err?.message,
      });
    }
    await sleep(200);
  }

  return deleted;
}