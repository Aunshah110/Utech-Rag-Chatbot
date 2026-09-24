// scripts/chunk.ts
// Stage 3 of the RAG ingestion pipeline: cleaned pages -> retrieval chunks.
//
// Fixes applied:
//   1. Output matches Chunk interface from types.ts exactly
//   2. heading_path is prepended to text for retrieval context
//   3. content_type derived from dominant block type per section
//   4. section_heading = nearest heading above the chunk
//   5. Also writes chunks.jsonl (JSONL format) for downstream streaming
//   6. Zod schema accepts 'faq' block type

import { z } from 'zod';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Chunk, ChunkContentType, CleanedPage, ContentBlock, ContentBlockType } from '../lib/types';
import { createLogger } from '../lib/utils/logger';
import { createTokenizer, Tokenizer } from '../lib/utils/tokenizer';
import { ChunkError, ConfigValidationError } from '../lib/utils/errors';



const log = createLogger('chunk');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ChunkConfigSchema = z
  .object({
    inputDir: z.string().min(1).default('data/cleaned'),
    outputDir: z.string().min(1).default('data/chunks'),
    maxTokens: z.number().int().positive().default(500),
    minTokens: z.number().int().min(0).default(200),   // ← was 100
    overlapTokens: z.number().int().min(0).default(75), // ← was 50
    encodingName: z.string().min(1).default('cl100k_base'),
  })
    .refine((c) => c.overlapTokens < c.maxTokens, {
    message: 'overlapTokens must be smaller than maxTokens',
  })
  .refine((c) => c.minTokens < c.maxTokens, {
    message: 'minTokens must be smaller than maxTokens',
  });

export type ChunkConfig = z.infer<typeof ChunkConfigSchema>;
export type ChunkConfigInput = z.input<typeof ChunkConfigSchema>;

function resolveConfig(input: ChunkConfigInput): ChunkConfig {
  const result = ChunkConfigSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigValidationError(`Invalid ChunkConfig: ${result.error.message}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const ContentBlockSchema = z.object({
  type: z.enum(['paragraph', 'list', 'table', 'faq']),
  content: z.string(),
  headingPath: z.array(z.string()),
});

const CleanedPageSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  headings: z.array(z.object({ level: z.number(), text: z.string() })),
  textBlocks: z.array(ContentBlockSchema),
  cleanedAt: z.string(),
  sourceHash: z.string(),
  depth: z.number(),
});

// ---------------------------------------------------------------------------
// Section grouping
// ---------------------------------------------------------------------------

interface Section {
  headingPath: string[];
  blocks: ContentBlock[];
}

function sameHeadingPath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function isDescendantOrSame(parent: string[], child: string[]): boolean {
  return parent.length <= child.length && parent.every((v, i) => v === child[i]);
}

function groupIntoSections(textBlocks: ContentBlock[]): Section[] {
  const sections: Section[] = [];
  for (const block of textBlocks) {
    const last = sections[sections.length - 1];
    if (last && sameHeadingPath(last.headingPath, block.headingPath)) {
      last.blocks.push(block);
    } else {
      sections.push({ headingPath: block.headingPath, blocks: [block] });
    }
  }
  return sections;
}

function sectionText(section: Section): string {
  return section.blocks.map((b) => b.content).join('\n\n');
}

/** Returns the dominant block type for a section, used as chunk content_type. */
function dominantContentType(section: Section): ChunkContentType {
  if (section.blocks.length === 0) return 'paragraph';

  const counts: Record<ContentBlockType, number> = {
    paragraph: 0,
    list: 0,
    table: 0,
    faq: 0,
  };
  for (const b of section.blocks) counts[b.type]++;

  // Priority: table > faq > list > paragraph for special types
  if (counts.table > 0 && counts.table >= section.blocks.length / 2) return 'table';
  if (counts.faq > 0 && counts.faq >= section.blocks.length / 2) return 'faq';
  if (counts.list > 0 && counts.list >= section.blocks.length / 2) return 'list';
  return 'paragraph';
}

// ---------------------------------------------------------------------------
// Small-section merging
// ---------------------------------------------------------------------------

function combineInOrder(first: Section, second: Section): Section {
  const headingPath =
    second.headingPath.length >= first.headingPath.length
      ? second.headingPath
      : first.headingPath;
  return { headingPath, blocks: [...first.blocks, ...second.blocks] };
}

function mergeSmallSections(
  sections: Section[],
  tokenizer: Tokenizer,
  minTokens: number
): Section[] {
  const merged: Section[] = [];

  for (const section of sections) {
    const prev = merged[merged.length - 1];
    const prevTokens = prev ? tokenizer.countTokens(sectionText(prev)) : 0;

    const prevIsSmallAndRelated =
      prev &&
      prevTokens < minTokens &&
      (isDescendantOrSame(prev.headingPath, section.headingPath) ||
        isDescendantOrSame(section.headingPath, prev.headingPath));

    if (prevIsSmallAndRelated && prev) {
      merged[merged.length - 1] = combineInOrder(prev, section);
    } else {
      merged.push({ headingPath: section.headingPath, blocks: [...section.blocks] });
    }
  }

  if (merged.length > 1) {
    const lastIdx = merged.length - 1;
    const lastTokens = tokenizer.countTokens(sectionText(merged[lastIdx]));
    if (lastTokens < minTokens) {
      const prevIdx = lastIdx - 1;
      merged[prevIdx] = combineInOrder(merged[prevIdx], merged[lastIdx]);
      merged.pop();
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Oversized block splitting
// ---------------------------------------------------------------------------

function splitOversizedBlock(text: string, tokenizer: Tokenizer, maxTokens: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|\S+$/g) ?? [text];
  const pieces: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (tokenizer.countTokens(candidate) > maxTokens && current) {
      pieces.push(current);
      current = sentence.trim();
    } else {
      current = candidate;
    }

    if (tokenizer.countTokens(current) > maxTokens) {
      pieces.push(...tokenizer.splitIntoTokenChunks(current, maxTokens));
      current = '';
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function splitSection(section: Section, tokenizer: Tokenizer, config: ChunkConfig): string[] {
  const chunks: string[] = [];
  let currentParts: string[] = [];
  let currentTokens = 0;

  const flush = (): void => {
    if (currentParts.length === 0) return;
    chunks.push(currentParts.join('\n\n'));
    currentParts = [];
    currentTokens = 0;
  };

  const addPiece = (piece: string): void => {
    const pieceTokens = tokenizer.countTokens(piece);

    if (pieceTokens > config.maxTokens) {
      flush();
      chunks.push(...tokenizer.splitIntoTokenChunks(piece, config.maxTokens));
      return;
    }

    if (currentTokens + pieceTokens > config.maxTokens && currentParts.length > 0) {
      flush();
      if (config.overlapTokens > 0) {
        const prevChunk = chunks[chunks.length - 1];
        const overlap = tokenizer.tailTokens(prevChunk, config.overlapTokens);
        if (overlap) {
          currentParts.push(overlap);
          currentTokens += tokenizer.countTokens(overlap);
        }
      }
    }

    currentParts.push(piece);
    currentTokens += pieceTokens;
  };

  for (const block of section.blocks) {
    const blockTokens = tokenizer.countTokens(block.content);
    if (blockTokens > config.maxTokens) {
      for (const piece of splitOversizedBlock(block.content, tokenizer, config.maxTokens)) {
        addPiece(piece);
      }
    } else {
      addPiece(block.content);
    }
  }
  flush();

  return chunks;
}

// ---------------------------------------------------------------------------
// Per-page chunking
// ---------------------------------------------------------------------------

/**
 * Builds the retrieval text for a chunk. Prepends heading path so embeddings
 * capture topical context, e.g.:
 *   "Admissions > Scholarships > Merit-Based\n\nEligibility: ..."
 */
function buildRetrievalText(content: string, headingPath: string[]): string {
  if (headingPath.length === 0) return content;
  return `${headingPath.join(' > ')}\n\n${content}`;
}

export function chunkPage(
  page: CleanedPage,
  config: ChunkConfig,
  tokenizer: Tokenizer
): Chunk[] {
  if (page.textBlocks.length === 0) return [];

  const sections = groupIntoSections(page.textBlocks);
  const merged = mergeSmallSections(sections, tokenizer, config.minTokens);

  const intermediate: {
    content: string;
    headingPath: string[];
    contentType: ChunkContentType;
  }[] = [];

  for (const section of merged) {
    // Account for the heading prefix in the token budget so that after
    // prepending, no chunk exceeds config.maxTokens.
    const headingPrefix = section.headingPath.length > 0
      ? section.headingPath.join(' > ') + '\n\n'
      : '';
    const prefixTokens = tokenizer.countTokens(headingPrefix);
    const effectiveMax = Math.max(config.maxTokens - prefixTokens, 100);

    const sectionConfig: ChunkConfig = { ...config, maxTokens: effectiveMax };
    const pieces = splitSection(section, tokenizer, sectionConfig);
    const ct = dominantContentType(section);

    for (const piece of pieces) {
      // Drop pieces that are essentially empty after trimming
      const trimmed = piece.trim();
      if (trimmed.length < 20) continue;
      intermediate.push({
        content: trimmed,
        headingPath: section.headingPath,
        contentType: ct,
      });
    }
  }

  const docId = createHash('sha256').update(page.url).digest('hex').slice(0, 16);
  const chunkCount = intermediate.length;

  return intermediate.map((c, index) => {
    const text = buildRetrievalText(c.content, c.headingPath);
    return {
      chunk_id: `${docId}-${index}`,
      doc_id: docId,
      text,
      token_count: tokenizer.countTokens(text),
      source_url: page.url,
      page_title: page.title,
      section_heading: c.headingPath[c.headingPath.length - 1] || page.title,
      heading_path: c.headingPath,
      content_type: c.contentType,
      crawled_at: page.cleanedAt,
      language: 'en',
      is_boilerplate: false,
      chunk_index: index,
      chunk_count: chunkCount,
      source_hash: page.sourceHash,
    };
  });
}


// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadCleanedPages(inputDir: string): CleanedPage[] {
  if (!existsSync(inputDir)) {
    throw new ChunkError(`Input directory does not exist: ${inputDir}`);
  }

  const files = readdirSync(inputDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  const pages: CleanedPage[] = [];

  for (const file of files) {
    const filePath = path.join(inputDir, file);
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      const result = CleanedPageSchema.safeParse(raw);
      if (!result.success) {
        log.warn('Skipping invalid CleanedPage file', {
          file,
          error: result.error.message,
        });
        continue;
      }
      pages.push(result.data);
    } catch (err) {
      log.warn('Failed to read/parse CleanedPage file, skipping', {
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return pages;
}

function urlToFilename(url: string): string {
  return createHash('sha256').update(url).digest('hex') + '.json';
}

export interface ChunkManifest {
  startedAt: string;
  finishedAt: string;
  config: ChunkConfig;
  pagesRead: number;
  pagesChunked: number;
  pagesFailed: number;
  totalChunks: number;
  avgChunksPerPage: number;
  avgTokensPerChunk: number;
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

export async function chunkAll(input: ChunkConfigInput = {}): Promise<ChunkManifest> {
  const config = resolveConfig(input);
  ensureDir(config.outputDir);
  const tokenizer = createTokenizer(config.encodingName);

  const startedAt = new Date().toISOString();
  const pages = loadCleanedPages(config.inputDir);
  log.info('Loaded cleaned pages', { count: pages.length });

  const stats = { pagesChunked: 0, pagesFailed: 0, totalChunks: 0, totalTokens: 0 };
  const allChunks: Chunk[] = [];

  for (const page of pages) {
    try {
      const chunks = chunkPage(page, config, tokenizer);
      if (chunks.length === 0) {
        log.debug('No chunks produced for page', { url: page.url });
        continue;
      }

      // Per-page JSON (keeps individual page chunks inspectable)
      const filePath = path.join(config.outputDir, urlToFilename(page.url));
      writeFileSync(filePath, JSON.stringify(chunks, null, 2), 'utf-8');

      allChunks.push(...chunks);
      stats.pagesChunked += 1;
      stats.totalChunks += chunks.length;
      stats.totalTokens += chunks.reduce((s, c) => s + c.token_count, 0);
    } catch (err) {
      stats.pagesFailed += 1;
      log.error('Failed to chunk page', {
        url: page.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Combined JSONL artifact (one chunk per line — standard for embedding pipelines)
  const jsonlPath = path.join(config.outputDir, 'chunks.jsonl');
  writeFileSync(jsonlPath, allChunks.map((c) => JSON.stringify(c)).join('\n'), 'utf-8');

  // Combined pretty JSON (for human inspection, may be large)
  const allPath = path.join(config.outputDir, '_all.json');
  writeFileSync(allPath, JSON.stringify(allChunks, null, 2), 'utf-8');

  const manifest: ChunkManifest = {
    startedAt,
    finishedAt: new Date().toISOString(),
    config,
    pagesRead: pages.length,
    pagesChunked: stats.pagesChunked,
    pagesFailed: stats.pagesFailed,
    totalChunks: stats.totalChunks,
    avgChunksPerPage:
      stats.pagesChunked > 0 ? Math.round((stats.totalChunks / stats.pagesChunked) * 10) / 10 : 0,
    avgTokensPerChunk:
      stats.totalChunks > 0 ? Math.round(stats.totalTokens / stats.totalChunks) : 0,
  };
  writeFileSync(
    path.join(config.outputDir, '_manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );
  log.info('Chunking complete', stats);

  return manifest;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  chunkAll({
    inputDir: process.env.CHUNK_INPUT_DIR,
    outputDir: process.env.CHUNK_OUTPUT_DIR,
    maxTokens: process.env.CHUNK_MAX_TOKENS ? Number(process.env.CHUNK_MAX_TOKENS) : undefined,
    minTokens: process.env.CHUNK_MIN_TOKENS ? Number(process.env.CHUNK_MIN_TOKENS) : undefined,
    overlapTokens: process.env.CHUNK_OVERLAP_TOKENS ? Number(process.env.CHUNK_OVERLAP_TOKENS) : undefined,
  })
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((err) => {
      log.error('Fatal chunk error', {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    });
}