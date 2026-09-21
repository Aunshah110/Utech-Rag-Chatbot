// scripts/index.ts
// Stage 5: embeddings.jsonl -> Upstash Vector
// Reads chunks+vectors and upserts them into the Upstash Vector DB.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { existsSync, createReadStream } from 'fs';
import * as readline from 'readline';
import { Index } from '@upstash/vector';
import { createLogger } from './utils/logger';
import { EmbedError, ConfigValidationError } from './utils/errors';
import type { Chunk } from './types';

const log = createLogger('index');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG = {
  inputFile: 'data/chunks/embeddings.jsonl',
  namespace: '',
  batchSize: 100,
  expectedDimensions: 1024,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChunkWithVector extends Chunk {
  vector: number[];
  embedding_model: string;
  embedded_at: string;
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

async function readJsonl(filePath: string): Promise<ChunkWithVector[]> {
  if (!existsSync(filePath)) {
    throw new ConfigValidationError(`Input file not found: ${filePath}`);
  }
  const results: ChunkWithVector[] = [];
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed.vector) || parsed.vector.length !== CONFIG.expectedDimensions) {
        log.warn('Skipping chunk with invalid vector', {
          chunk_id: parsed.chunk_id,
          vector_length: parsed.vector?.length,
        });
        continue;
      }
      results.push(parsed);
    } catch (err) {
      log.warn('Skipping malformed line', {
        line: lineNo,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Upstash client
// ---------------------------------------------------------------------------

function createIndex(): Index {
  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (!url || !token) {
    throw new ConfigValidationError(
      'UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN must be set'
    );
  }
  return new Index({ url, token });
}

// ---------------------------------------------------------------------------
// Metadata shaping
// ---------------------------------------------------------------------------

/**
 * Upstash Vector metadata must be flat key→value pairs.
 * Arrays are joined with ' > ' so they're still readable as strings.
 */
function buildMetadata(chunk: ChunkWithVector): Record<string, string | number | boolean> {
  return {
    doc_id: chunk.doc_id,
    source_url: chunk.source_url,
    page_title: chunk.page_title,
    section_heading: chunk.section_heading,
    heading_path: chunk.heading_path.join(' > '),
    content_type: chunk.content_type,
    token_count: chunk.token_count,
    chunk_index: chunk.chunk_index,
    chunk_count: chunk.chunk_count,
    crawled_at: chunk.crawled_at,
    language: chunk.language,
    source_hash: chunk.source_hash,
    // Store the chunk text as metadata so retrieval returns it without a
    // second lookup against a separate datastore.
    text: chunk.text,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startedAt = Date.now();
  log.info('Loading embeddings', { file: CONFIG.inputFile });

  const chunks = await readJsonl(CONFIG.inputFile);
  log.info('Loaded chunks with vectors', { count: chunks.length });

  if (chunks.length === 0) {
    throw new EmbedError('No embeddings to index');
  }

  const index = createIndex();
  const totalBatches = Math.ceil(chunks.length / CONFIG.batchSize);

  for (let i = 0; i < chunks.length; i += CONFIG.batchSize) {
    const batch = chunks.slice(i, i + CONFIG.batchSize);
    const batchNo = Math.floor(i / CONFIG.batchSize) + 1;

    log.info('Upserting batch', {
      batch: `${batchNo}/${totalBatches}`,
      size: batch.length,
    });

    const payload = batch.map((c) => ({
      id: c.chunk_id,
      vector: c.vector,
      metadata: buildMetadata(c),
    }));

    try {
      await index.upsert(payload, { namespace: CONFIG.namespace || undefined });
    } catch (err: any) {
      log.error('Batch upsert failed', {
        batch: batchNo,
        error: err?.message ?? String(err),
      });
      throw new EmbedError(`Upsert failed on batch ${batchNo}`);
    }

    // Polite pacing
    if (i + CONFIG.batchSize < chunks.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Verify final size
  const stats = await index.info();
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  log.info('Indexing complete', {
    upserted: chunks.length,
    elapsedSec,
    indexInfo: stats,
  });
}

main().catch((err) => {
  log.error('Fatal index error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});