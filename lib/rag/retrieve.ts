// scripts/retrieve.ts

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { CohereClient } from 'cohere-ai';
import { Index } from '@upstash/vector';
import { createLogger } from '../utils/logger';
import { ConfigValidationError } from '../utils/errors';



const log = createLogger('retrieve');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface RetrieveConfig {
  /** Top-K from vector search before reranking */
  retrieveTopK: number;
  /** Top-N after reranking */
  rerankTopN: number;
  /** Minimum vector similarity score to proceed (0-1) */
  minVectorScore: number;
  /** Minimum rerank score to keep a chunk (0-1) */
  minRerankScore: number;
  /** Cohere embed model */
  embedModel: string;
  /** Cohere rerank model */
  rerankModel: string;
  /** Namespace in Upstash Vector (empty = default) */
  namespace: string;
}

const CONFIG: RetrieveConfig = {
  retrieveTopK: 15,
  rerankTopN: 5,
  minVectorScore: 0.45,
  minRerankScore: 0.25,
  embedModel: 'embed-english-v3.0',
  rerankModel: 'rerank-v3.5',
  namespace: '',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetrievedChunk {
  chunk_id: string;
  text: string;
  source_url: string;
  page_title: string;
  section_heading: string;
  heading_path: string;
  content_type: string;
  token_count: number;
  /** Vector similarity score from Upstash (0-1) */
  vector_score: number;
  /** Rerank relevance score from Cohere (0-1), undefined if rerank skipped */
  rerank_score?: number;
}

export interface RetrievalResult {
  /** Whether the pipeline found sufficient evidence */
  confident: boolean;
  /** Reason if not confident — surfaced to the user/generator */
  reason?: 'no_results' | 'low_vector_score' | 'low_rerank_score' | 'error';
  /** Final chunks, sorted by relevance. Empty if not confident. */
  chunks: RetrievedChunk[];
  /** Diagnostics for logging/eval */
  diagnostics: {
    vector_top_score: number;
    rerank_top_score: number | null;
    candidates_retrieved: number;
    candidates_after_rerank: number;
    elapsed_ms: number;
  };
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

/**
 * Embed a user query using input_type="search_query".
 *
 * CRITICAL: This is NOT the same input_type used for documents.
 * Cohere's v3 models are asymmetric — they produce different embeddings
 * for the same text depending on whether it's a document or a query.
 * Using the wrong input_type silently degrades retrieval quality. [citation:1][citation:19]
 */
async function embedQuery(
  client: CohereClient,
  query: string
): Promise<number[]> {
  const response = await client.embed({
    model: CONFIG.embedModel,
    texts: [query],
    inputType: 'search_query',   // ← MANDATORY for v3 models
    embeddingTypes: ['float'],
  });

  const embeddings = (response as any).embeddings?.float ?? (response as any).embeddings;
  if (!embeddings || !Array.isArray(embeddings) || embeddings.length === 0) {
    throw new Error('Cohere returned no embedding for query');
  }

  return embeddings[0];
}

// ---------------------------------------------------------------------------
// Upstash client
// ---------------------------------------------------------------------------

function createUpstashIndex(): Index {
  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (!url || !token) {
    throw new ConfigValidationError(
      'UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN must be set'
    );
  }
  return new Index({ url, token });
}

/**
 * Query Upstash Vector with a pre-computed query embedding.
 *
 * Upstash returns scores normalized to 0-1 (1 = most similar) regardless
 * of the underlying distance metric. [citation:3][citation:15]
 */
async function vectorSearch(
  index: Index,
  queryVector: number[],
  topK: number
): Promise<RetrievedChunk[]> {
  const results = await index.query({
    vector: queryVector,
    topK,
    includeMetadata: true,   // We need text, source_url, etc.
    includeVectors: false,   // Don't return 1024 floats — waste of bandwidth
  });

  return results.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, any>;
    return {
      chunk_id: String(r.id),
      text: String(meta.text ?? ''),
      source_url: String(meta.source_url ?? ''),
      page_title: String(meta.page_title ?? ''),
      section_heading: String(meta.section_heading ?? ''),
      heading_path: String(meta.heading_path ?? ''),
      content_type: String(meta.content_type ?? ''),
      token_count: Number(meta.token_count ?? 0),
      vector_score: Number(r.score ?? 0),
    };
  });
}

// ---------------------------------------------------------------------------
// Reranking
// ---------------------------------------------------------------------------

/**
 * Rerank candidate chunks using Cohere Rerank 3.5.
 *
 * Rerank is a cross-encoder: it scores each (query, document) pair
 * directly, which is far more accurate than cosine similarity alone.
 * Typical effect: top-5 precision improves 10-25%. [citation:2][citation:4]
 *
 * Cost: ~$0.30 per 10,000 documents reranked. For 15 docs/query, that's
 * roughly $0.00045 per user message — negligible. [citation:14]
 */
async function rerankChunks(
  client: CohereClient,
  query: string,
  chunks: RetrievedChunk[]
): Promise<RetrievedChunk[]> {
  if (chunks.length === 0) return [];

  try {
    const response = await client.rerank({
      model: CONFIG.rerankModel,
      query,
      documents: chunks.map((c) => c.text),
      topN: Math.min(CONFIG.rerankTopN, chunks.length),
    });

    const results = (response as any).results ?? [];
    const reranked: RetrievedChunk[] = [];

    for (const r of results) {
      const idx = r.index ?? r.originalIndex;
      const chunk = chunks[idx];
      if (!chunk) continue;

      reranked.push({
        ...chunk,
        rerank_score: Number(r.relevanceScore ?? r.score ?? 0),
      });
    }

    return reranked;
  } catch (err: any) {
    // Rerank failure must NOT fail the whole request. Fall back to
    // vector-ranked order. This is a deliberate degradation, not a bug.
    log.warn('Rerank failed, falling back to vector ranking', {
      error: err?.message ?? String(err),
    });
    return chunks.slice(0, CONFIG.rerankTopN);
  }
}

// ---------------------------------------------------------------------------
// Main retrieval pipeline
// ---------------------------------------------------------------------------

/**
 * Full retrieval pipeline: embed → search → gate → rerank → gate.
 *
 * Returns `confident: false` with a `reason` when evidence is insufficient.
 * The caller (generate.ts) MUST respect this and refuse to answer.
 */
export async function retrieve(
  query: string,
  config: Partial<RetrieveConfig> = {}
): Promise<RetrievalResult> {
  const cfg = { ...CONFIG, ...config };
  const startedAt = Date.now();

  const emptyDiagnostics = {
    vector_top_score: 0,
    rerank_top_score: null,
    candidates_retrieved: 0,
    candidates_after_rerank: 0,
    elapsed_ms: 0,
  };

  // Guard: reject empty or absurdly short queries
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return {
      confident: false,
      reason: 'no_results',
      chunks: [],
      diagnostics: { ...emptyDiagnostics, elapsed_ms: Date.now() - startedAt },
    };
  }

  const cohere = createCohereClient();
  const upstash = createUpstashIndex();

  // -------------------------------------------------------------------------
  // Stage 1: Embed query
  // -------------------------------------------------------------------------
  let queryVector: number[];
  try {
    queryVector = await embedQuery(cohere, trimmed);
  } catch (err: any) {
    log.error('Query embedding failed', { error: err?.message ?? String(err) });
    return {
      confident: false,
      reason: 'error',
      chunks: [],
      diagnostics: { ...emptyDiagnostics, elapsed_ms: Date.now() - startedAt },
    };
  }

  // -------------------------------------------------------------------------
  // Stage 2: Vector search
  // -------------------------------------------------------------------------
  let candidates: RetrievedChunk[];
  try {
    candidates = await vectorSearch(upstash, queryVector, cfg.retrieveTopK);
  } catch (err: any) {
    log.error('Vector search failed', { error: err?.message ?? String(err) });
    return {
      confident: false,
      reason: 'error',
      chunks: [],
      diagnostics: { ...emptyDiagnostics, elapsed_ms: Date.now() - startedAt },
    };
  }

  if (candidates.length === 0) {
    return {
      confident: false,
      reason: 'no_results',
      chunks: [],
      diagnostics: { ...emptyDiagnostics, elapsed_ms: Date.now() - startedAt },
    };
  }

  const vectorTopScore = candidates[0].vector_score;

  // -------------------------------------------------------------------------
  // Stage 3: Confidence gate #1 (vector similarity)
  // -------------------------------------------------------------------------
  if (vectorTopScore < cfg.minVectorScore) {
    log.info('Confidence gate: vector score below threshold', {
      vector_top_score: vectorTopScore,
      threshold: cfg.minVectorScore,
    });
    return {
      confident: false,
      reason: 'low_vector_score',
      chunks: [],
      diagnostics: {
        vector_top_score: vectorTopScore,
        rerank_top_score: null,
        candidates_retrieved: candidates.length,
        candidates_after_rerank: 0,
        elapsed_ms: Date.now() - startedAt,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Stage 4: Rerank
  // -------------------------------------------------------------------------
  const reranked = await rerankChunks(cohere, trimmed, candidates);
  const rerankTopScore = reranked.length > 0 && reranked[0].rerank_score !== undefined
    ? reranked[0].rerank_score
    : null;

  // -------------------------------------------------------------------------
  // Stage 5: Confidence gate #2 (rerank relevance)
  // -------------------------------------------------------------------------
  // Only apply if we actually got rerank scores. If rerank fell back,
  // trust the vector score gate that already passed.
  if (rerankTopScore !== null && rerankTopScore < cfg.minRerankScore) {
    log.info('Confidence gate: rerank score below threshold', {
      rerank_top_score: rerankTopScore,
      threshold: cfg.minRerankScore,
    });
    return {
      confident: false,
      reason: 'low_rerank_score',
      chunks: [],
      diagnostics: {
        vector_top_score: vectorTopScore,
        rerank_top_score: rerankTopScore,
        candidates_retrieved: candidates.length,
        candidates_after_rerank: reranked.length,
        elapsed_ms: Date.now() - startedAt,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Stage 6: Filter & return
  // -------------------------------------------------------------------------
  // Keep only chunks above the rerank floor. If rerank produced nothing
  // above floor, take the top 3 vector-ranked as fallback.
  let finalChunks: RetrievedChunk[];
  if (rerankTopScore !== null) {
    finalChunks = reranked.filter(
      (c) => (c.rerank_score ?? 0) >= cfg.minRerankScore
    );
  } else {
    finalChunks = candidates.slice(0, cfg.rerankTopN);
  }

  if (finalChunks.length === 0) {
    finalChunks = reranked.slice(0, Math.min(3, reranked.length));
  }

  const elapsed = Date.now() - startedAt;
  log.info('Retrieval complete', {
    query: trimmed.slice(0, 60),
    vector_top: vectorTopScore.toFixed(3),
    rerank_top: rerankTopScore?.toFixed(3) ?? 'n/a',
    returned: finalChunks.length,
    elapsed_ms: elapsed,
  });

  return {
    confident: true,
    chunks: finalChunks,
    diagnostics: {
      vector_top_score: vectorTopScore,
      rerank_top_score: rerankTopScore,
      candidates_retrieved: candidates.length,
      candidates_after_rerank: reranked.length,
      elapsed_ms: elapsed,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI entry (for testing)
// ---------------------------------------------------------------------------

if (require.main === module) {
  const query = process.argv.slice(2).join(' ').trim();

  if (!query) {
    console.error('Usage: npx ts-node scripts/retrieve.ts "your question here"');
    process.exit(1);
  }

  retrieve(query)
    .then((result) => {
      console.log('\n' + '='.repeat(72));
      console.log('QUERY:', query);
      console.log('CONFIDENT:', result.confident);
      if (result.reason) console.log('REASON:', result.reason);
      console.log('DIAGNOSTICS:', JSON.stringify(result.diagnostics, null, 2));
      console.log('='.repeat(72));

      if (!result.confident) {
        console.log('→ No answer would be generated (refusal path).');
        return;
      }

      for (const [i, c] of result.chunks.entries()) {
        console.log(`\n[${i + 1}] vector=${c.vector_score.toFixed(3)} rerank=${c.rerank_score?.toFixed(3) ?? 'n/a'}`);
        console.log('    source:', c.source_url);
        console.log('    heading:', c.heading_path || '(none)');
        console.log('    type:', c.content_type, '| tokens:', c.token_count);
        console.log('    text:', c.text.slice(0, 220).replace(/\n/g, ' '));
      }
    })
    .catch((err) => {
      log.error('Fatal retrieve error', { error: err?.message ?? String(err) });
      process.exit(1);
    });
}