// chunk.ts

import { z } from 'zod';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Chunk, CleanedPage, ContentBlock } from './types';
import { createLogger } from './utils/logger';
import { createTokenizer, Tokenizer } from './utils/tokenizer';
import { ChunkError, ConfigValidationError } from './utils/errors';

const log = createLogger('chunk');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ChunkConfigSchema = z
    .object({
        inputDir: z.string().min(1).default('data/cleaned'),
        outputDir: z.string().min(1).default('data/chunks'),
        maxTokens: z.number().int().positive().default(500),
        minTokens: z.number().int().min(0).default(100),
        overlapTokens: z.number().int().min(0).default(50),
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
// Input validation (boundary check on data produced by clean.ts)
// ---------------------------------------------------------------------------

const ContentBlockSchema = z.object({
    type: z.enum(['paragraph', 'list', 'table']),
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
// Step 1: group content blocks into heading-scoped sections
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

// ---------------------------------------------------------------------------
// Step 2: merge undersized sections with an adjacent sibling/parent section
// ---------------------------------------------------------------------------

/** Combines two sections' blocks in document order (`first` precedes `second`). */
function combineInOrder(first: Section, second: Section): Section {

    const headingPath =
        second.headingPath.length >= first.headingPath.length ? second.headingPath : first.headingPath;
    return { headingPath, blocks: [...first.blocks, ...second.blocks] };
}

function mergeSmallSections(sections: Section[], tokenizer: Tokenizer, minTokens: number): Section[] {
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
// Step 3: split oversized sections into token-bounded chunks with overlap
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

        // A single sentence longer than maxTokens on its own: split losslessly
        // rather than truncating, so no content is silently dropped.
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
            // Shouldn't normally happen (handled by splitOversizedBlock upstream),
            // but guard defensively in case a piece still exceeds the limit.
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

/** Chunks a single CleanedPage into an array of retrieval-ready Chunks. */
export function chunkPage(page: CleanedPage, config: ChunkConfig, tokenizer: Tokenizer): Chunk[] {
    if (page.textBlocks.length === 0) return [];

    const sections = groupIntoSections(page.textBlocks);
    const merged = mergeSmallSections(sections, tokenizer, config.minTokens);

    const contents: { content: string; headingPath: string[] }[] = [];
    for (const section of merged) {
        const pieces = splitSection(section, tokenizer, config);
        for (const piece of pieces) {
            contents.push({ content: piece, headingPath: section.headingPath });
        }
    }

    const urlHash = createHash('sha256').update(page.url).digest('hex').slice(0, 16);
    const createdAt = new Date().toISOString();

    return contents.map((c, index) => ({
        id: `${urlHash}-${index}`,
        pageUrl: page.url,
        pageTitle: page.title,
        content: c.content,
        headingPath: c.headingPath,
        chunkIndex: index,
        chunkCount: contents.length,
        tokenCount: tokenizer.countTokens(c.content),
        metadata: {
            sourceHash: page.sourceHash,
            createdAt,
        },
    }));
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
                log.warn('Skipping invalid CleanedPage file', { file, error: result.error.message });
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

    const stats = { pagesChunked: 0, pagesFailed: 0, totalChunks: 0 };
    const allChunks: Chunk[] = [];

    for (const page of pages) {
        try {
            const chunks = chunkPage(page, config, tokenizer);
            if (chunks.length === 0) {
                log.debug('No chunks produced for page', { url: page.url });
                continue;
            }

            const filePath = path.join(config.outputDir, urlToFilename(page.url));
            writeFileSync(filePath, JSON.stringify(chunks, null, 2), 'utf-8');

            allChunks.push(...chunks);
            stats.pagesChunked += 1;
            stats.totalChunks += chunks.length;
        } catch (err) {
            stats.pagesFailed += 1;
            log.error('Failed to chunk page', { url: page.url, error: err instanceof Error ? err.message : String(err) });
        }
    }

    writeFileSync(path.join(config.outputDir, '_all.json'), JSON.stringify(allChunks, null, 2), 'utf-8');

    const manifest: ChunkManifest = {
        startedAt,
        finishedAt: new Date().toISOString(),
        config,
        pagesRead: pages.length,
        ...stats,
    };
    writeFileSync(path.join(config.outputDir, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
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
            log.error('Fatal chunk error', { error: err instanceof Error ? err.message : String(err) });
            process.exit(1);
        });
}