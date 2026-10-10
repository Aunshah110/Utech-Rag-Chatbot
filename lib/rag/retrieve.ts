// lib/rag/retrieve.ts

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { CohereClient } from 'cohere-ai';
import { Index } from '@upstash/vector';
import { createLogger } from '../utils/logger';
import { ConfigValidationError } from '../utils/errors';
import { STATIC_FACTS, StaticFact } from './static-facts';

const log = createLogger('retrieve');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface RetrieveConfig {
  retrieveTopK: number;
  rerankTopN: number;
  minVectorScore: number;
  minRerankScore: number;
  embedModel: string;
  rerankModel: string;
  namespace: string;
}

const CONFIG: RetrieveConfig = {
  retrieveTopK: 15,
  rerankTopN: 5,
  minVectorScore: 0.45,
  minRerankScore: 0.15,
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
  vector_score: number;
  rerank_score?: number;
}

export interface RetrievalResult {
  confident: boolean;
  reason?: 'no_results' | 'low_vector_score' | 'low_rerank_score' | 'error';
  chunks: RetrievedChunk[];
  diagnostics: {
    vector_top_score: number;
    rerank_top_score: number | null;
    candidates_retrieved: number;
    candidates_after_rerank: number;
    elapsed_ms: number;
  };
}

// ---------------------------------------------------------------------------
// Static fact matching
// ---------------------------------------------------------------------------

/**
 * Detects whether the query matches any static fact triggers.
 * Applies priority-based suppression: within each group, only the
 * highest-priority matching fact is kept.
 *
 * Examples:
 *   "who is syed aun"        → developer-syed-aun only (priority 10)
 *   "who developed this"     → developer-team only (priority 5)
 *   "who is abbas"           → developer-abbas only (priority 10)
 *   "what is your tech stack"→ project-info only
 */
function matchStaticFacts(query: string): StaticFact[] {
  const q = query.toLowerCase();

  const matched = STATIC_FACTS.filter((fact) =>
    fact.triggers.some((trigger) => {
      const t = trigger.toLowerCase();
      if (t.includes(' ')) return q.includes(t);
      return new RegExp(
        `\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'i'
      ).test(q);
    })
  );

  if (matched.length === 0) return [];

  // Group and find the max priority within each group.
  const maxPriorityByGroup = new Map<string, number>();
  for (const fact of matched) {
    const group = fact.group ?? `solo-${fact.id}`;
    const p = fact.priority ?? 0;
    const current = maxPriorityByGroup.get(group);
    if (current === undefined || p > current) {
      maxPriorityByGroup.set(group, p);
    }
  }

  // Keep only facts at the group's max priority.
  return matched.filter((fact) => {
    const group = fact.group ?? `solo-${fact.id}`;
    return (fact.priority ?? 0) === maxPriorityByGroup.get(group);
  });
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

async function embedQuery(client: CohereClient, query: string): Promise<number[]> {
  const response = await client.embed({
    model: CONFIG.embedModel,
    texts: [query],
    inputType: 'search_query',
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

async function vectorSearch(
  index: Index,
  queryVector: number[],
  topK: number
): Promise<RetrievedChunk[]> {
  const results = await index.query({
    vector: queryVector,
    topK,
    includeMetadata: true,
    includeVectors: false,
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
    log.warn('Rerank failed, falling back to vector ranking', {
      error: err?.message ?? String(err),
    });
    return chunks.slice(0, CONFIG.rerankTopN);
  }
}

// ---------------------------------------------------------------------------
// Query expansion
// ---------------------------------------------------------------------------

function expandQuery(query: string): string {
  const words = query.trim().split(/\s+/);
  const q = query.toLowerCase();

  if (words.length > 5) return query;

  const domains: Array<{ pattern: RegExp; expansion: string }> = [
    { pattern: /apply|application|admission|enroll/i, expansion: 'admission application online apply process how to bbsutsd' },
    { pattern: /fee|tuition|cost|payment/i,          expansion: 'fee structure tuition payment bbsutsd university' },
    { pattern: /faculty|teacher|prof|staff|lecturer/i, expansion: 'faculty department teacher professor bbsutsd university' },
    { pattern: /program|course|degree|major|curriculum/i, expansion: 'program degree course curriculum bbsutsd university' },
    { pattern: /hostel|transport|sport|library|lab|facility/i, expansion: 'facilities hostel transport library labs bbsutsd university' },
    { pattern: /contact|email|phone|address|location/i, expansion: 'contact email phone address location bbsutsd university' },
    { pattern: /scholarship|financial.?aid|stipend/i, expansion: 'scholarship financial aid bbsutsd university' },
    { pattern: /exam|result|grade|marks|gpa/i,        expansion: 'examination result grades bbsutsd university' },
    { pattern: /vision|mission|history|introduction/i, expansion: 'about vision mission history bbsutsd university' },
  ];

  for (const { pattern, expansion } of domains) {
    if (pattern.test(q)) {
      const expanded = `${query} ${expansion}`;
      log.debug('Query expanded', { original: query, expanded });
      return expanded;
    }
  }

  if (words.length <= 2) {
    const expanded = `${query} bbsutsd university`;
    log.debug('Query expanded (generic)', { original: query, expanded });
    return expanded;
  }

  return query;
}

// ---------------------------------------------------------------------------
// Main retrieval pipeline
// ---------------------------------------------------------------------------

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

  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return {
      confident: false,
      reason: 'no_results',
      chunks: [],
      diagnostics: { ...emptyDiagnostics, elapsed_ms: Date.now() - startedAt },
    };
  }

  // ── Stage 0: Static fact check (short-circuits vector search) ──────────
  const staticMatches = matchStaticFacts(trimmed);
  if (staticMatches.length > 0) {
    log.info('Static fact match — bypassing vector search', {
      query: trimmed.slice(0, 60),
      facts: staticMatches.map((f) => f.id),
    });

    const staticChunks: RetrievedChunk[] = staticMatches.map((fact) => ({
      chunk_id: `static-${fact.id}`,
      text: fact.content,
      source_url: fact.sourceUrl ?? '',
      page_title: fact.sourceTitle ?? 'Internal project metadata',
      section_heading: 'About',
      heading_path: fact.sourceTitle ?? 'About',
      content_type: 'paragraph',
      token_count: Math.ceil(fact.content.length / 4),
      vector_score: 1.0,
      rerank_score: 1.0,
    }));

    return {
      confident: true,
      chunks: staticChunks,
      diagnostics: {
        vector_top_score: 1.0,
        rerank_top_score: 1.0,
        candidates_retrieved: staticChunks.length,
        candidates_after_rerank: staticChunks.length,
        elapsed_ms: Date.now() - startedAt,
      },
    };
  }
  // ── End static fact check ──────────────────────────────────────────────

  const cohere = createCohereClient();
  const upstash = createUpstashIndex();

  // Stage 1: Embed query
  let queryVector: number[];
  try {
    const expandedQuery = expandQuery(trimmed);
    queryVector = await embedQuery(cohere, expandedQuery);
  } catch (err: any) {
    log.error('Query embedding failed', { error: err?.message ?? String(err) });
    return {
      confident: false,
      reason: 'error',
      chunks: [],
      diagnostics: { ...emptyDiagnostics, elapsed_ms: Date.now() - startedAt },
    };
  }

  // Stage 2: Vector search
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

  // Stage 3: Confidence gate #1
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

  // Stage 4: Rerank
  const reranked = await rerankChunks(cohere, trimmed, candidates);
  const rerankTopScore = reranked.length > 0 && reranked[0].rerank_score !== undefined
    ? reranked[0].rerank_score
    : null;

  // Stage 5: Confidence gate #2
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

  // Stage 6: Filter & return
  let finalChunks: RetrievedChunk[];
  if (rerankTopScore !== null) {
    finalChunks = reranked.filter((c) => (c.rerank_score ?? 0) >= cfg.minRerankScore);
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
// CLI entry
// ---------------------------------------------------------------------------

if (require.main === module) {
  const query = process.argv.slice(2).join(' ').trim();

  if (!query) {
    console.error('Usage: npx tsx lib/rag/retrieve.ts "your question here"');
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
        console.log('    source:', c.source_url || '(static fact — no URL)');
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