// scripts/embed.ts
// Stage 4: chunks.jsonl -> embeddings.jsonl (Cohere Embed v3)
// Reads retrieval chunks, generates Cohere embeddings in batches,
// writes chunks + vectors to a new JSONL file.

import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });
import { existsSync, writeFileSync, createReadStream } from 'fs';
import * as readline from 'readline';
import { CohereClient } from 'cohere-ai';
import { createLogger } from '../lib/utils/logger';
import { EmbedError, ConfigValidationError }  from '../lib/utils/errors';
import type { Chunk } from '../lib/types';

const log = createLogger('embed');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface EmbedConfig {
  inputFile: string;
  outputFile: string;
  model: string;
  dimensions: number;
  batchSize: number;
  maxRetries: number;
}

const CONFIG: EmbedConfig = {
  inputFile: 'data/chunks/chunks.jsonl',
  outputFile: 'data/chunks/embeddings.jsonl',
  model: 'embed-english-v3.0',
  dimensions: 1024,
  batchSize: 96,
  maxRetries: 3,
};

// ---------------------------------------------------------------------------
// Chunk schema (matches types.ts)
// ---------------------------------------------------------------------------

interface ChunkWithVector extends Chunk {
  vector: number[];
  embedding_model: string;
  embedded_at: string;
}

const REQUIRED_FIELDS: (keyof Chunk)[] = [
  'chunk_id',
  'doc_id',
  'text',
  'source_url',
  'page_title',
  'heading_path',
  'content_type',
  'token_count',
];

function validateChunk(obj: any, lineNo: number): Chunk {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in obj)) {
      throw new EmbedError(`Missing field "${field}" on line ${lineNo}`);
    }
  }
  if (typeof obj.text !== 'string' || obj.text.trim().length === 0) {
    throw new EmbedError(`Empty text on line ${lineNo}`);
  }
  return obj as Chunk;
}

// ---------------------------------------------------------------------------
// JSONL reader
// ---------------------------------------------------------------------------

async function readJsonl<T>(filePath: string, parseFn: (obj: any, lineNo: number) => T): Promise<T[]> {
  if (!existsSync(filePath)) {
    throw new ConfigValidationError(`Input file not found: ${filePath}`);
  }
  const results: T[] = [];
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
      results.push(parseFn(parsed, lineNo));
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
// Cohere client
// ---------------------------------------------------------------------------

function createCohereClient(): CohereClient {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    throw new ConfigValidationError('COHERE_API_KEY is not set');
  }
  return new CohereClient({ token: apiKey });
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function embedBatch(
  client: CohereClient,
  texts: string[],
  config: EmbedConfig
): Promise<number[][]> {
  let attempt = 0;
  while (attempt <= config.maxRetries) {
    try {
      const response = await client.embed({
        model: config.model,
        texts: texts,
        inputType: 'search_document',
        embeddingTypes: ['float'],
      });

      // Cohere v2 SDK returns embeddings in a structured format
      const embeddings = (response as any).embeddings?.float || (response as any).embeddings;
      if (!embeddings || !Array.isArray(embeddings)) {
        throw new EmbedError(`Unexpected Cohere response shape: ${JSON.stringify(Object.keys(response || {}))}`);
      }
      return embeddings;
    } catch (err: any) {
      const status = err?.statusCode ?? err?.status ?? err?.response?.status;
      const errorBody = err?.message ?? JSON.stringify(err?.body ?? err);

      log.warn('Embedding request failed', {
        attempt,
        status,
        errorBody,
      });

      // Auth errors are NOT retryable
      if (status === 401 || status === 403) {
        throw new EmbedError(`Cohere auth error: ${errorBody}`);
      }

      // Only retry 429 and 5xx
      const retryable = status === 429 || (status >= 500 && status < 600);
      if (!retryable) {
        throw new EmbedError(`Non-retryable error: ${errorBody}`);
      }

      attempt++;
      if (attempt > config.maxRetries) {
        throw new EmbedError(`Exhausted retries. Last error: ${errorBody}`);
      }
      // Cohere trial resets every 60s — wait at least that long on 429
        const backoff = status === 429
          ? 60000
          : Math.min(1000 * 2 ** attempt, 20000);
      await sleep(backoff);
    }
  }
  throw new EmbedError('Unreachable');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startedAt = Date.now();
  log.info('Loading chunks', { file: CONFIG.inputFile });

  const chunks = await readJsonl<Chunk>(CONFIG.inputFile, validateChunk);
  log.info('Loaded chunks', { count: chunks.length });

  if (chunks.length === 0) {
    throw new EmbedError('No chunks to embed');
  }

  const client = createCohereClient();
  const out: ChunkWithVector[] = [];
  const totalBatches = Math.ceil(chunks.length / CONFIG.batchSize);

  for (let i = 0; i < chunks.length; i += CONFIG.batchSize) {
    const batch = chunks.slice(i, i + CONFIG.batchSize);
    const batchNo = Math.floor(i / CONFIG.batchSize) + 1;
    const texts = batch.map((c) => c.text);

    log.info('Embedding batch', {
      batch: `${batchNo}/${totalBatches}`,
      size: batch.length,
    });

    const vectors = await embedBatch(client, texts, CONFIG);

    if (vectors.length !== batch.length) {
      throw new EmbedError(
        `Vector count mismatch: expected ${batch.length}, got ${vectors.length}`
      );
    }

    const embeddedAt = new Date().toISOString();
    for (let j = 0; j < batch.length; j++) {
      out.push({
        ...batch[j],
        vector: vectors[j],
        embedding_model: CONFIG.model,
        embedded_at: embeddedAt,
      });
    }

    // Cohere trial: 2,000 inputs/min. 96 per batch = ~20 batches/min max.
    // 1-second pause between batches keeps us well under the limit.
    if (i + CONFIG.batchSize < chunks.length) await sleep(10000);
  }

  // Write as JSONL
  writeFileSync(
    CONFIG.outputFile,
    out.map((c) => JSON.stringify(c)).join('\n'),
    'utf-8'
  );

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  log.info('Embeddings written', {
    file: CONFIG.outputFile,
    count: out.length,
    dimensions: CONFIG.dimensions,
    elapsedSec,
  });
}

main().catch((err) => {
  log.error('Fatal embed error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});