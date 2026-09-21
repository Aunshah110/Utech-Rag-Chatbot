// scripts/types.ts
// Single source of truth for pipeline data contracts.
// crawl.ts -> clean.ts -> chunk.ts -> embed.ts

// ---------------------------------------------------------------------------
// Stage 1: Raw crawled page
// ---------------------------------------------------------------------------

export interface RawPage {
  url: string;
  html: string;
  statusCode: number;
  fetchedAt: string;
  contentType: string;
  depth: number;
}

// ---------------------------------------------------------------------------
// Stage 2: Cleaned page
// ---------------------------------------------------------------------------

export interface Heading {
  level: number;
  text: string;
}

export type ContentBlockType = 'paragraph' | 'list' | 'table' | 'faq';

export interface ContentBlock {
  type: ContentBlockType;
  content: string;
  headingPath: string[];
}

export interface CleanedPage {
  url: string;
  title: string;
  headings: Heading[];
  textBlocks: ContentBlock[];
  cleanedAt: string;      // ISO-8601
  sourceHash: string;     // SHA-256 of normalized content
  depth: number;
}

// ---------------------------------------------------------------------------
// Stage 3: Retrieval-ready chunk
// Aligned with the embed.ts contract. Do not rename without updating embed.ts.
// ---------------------------------------------------------------------------

export type ChunkContentType = 'paragraph' | 'list' | 'table' | 'faq' | 'policy' | 'contact';

export interface Chunk {
  /** UUID v4, unique per chunk */
  chunk_id: string;

  /** Stable hash of the source URL — groups chunks by page */
  doc_id: string;

  /** The chunk content, with heading path prepended for retrieval context */
  text: string;

  /** Token count using gpt-tokenizer or equivalent */
  token_count: number;

  /** Source page URL — every chunk must trace to exactly one URL */
  source_url: string;

  /** Page title from <title> or first H1 */
  page_title: string;

  /** The nearest heading above this chunk */
  section_heading: string;

  /** Full heading path, e.g. ["Admissions","Scholarships","Merit-Based"] */
  heading_path: string[];

  /** Dominant content type — drives filtering and display */
  content_type: ChunkContentType;

  /** When the source page was crawled */
  crawled_at: string;

  /** ISO 639-1 language code */
  language: string;

  /** True if content looks like boilerplate (nav, contact-us stubs) */
  is_boilerplate: boolean;

  /** Position of this chunk within its source page (0-indexed) */
  chunk_index: number;

  /** Total chunks produced from the source page */
  chunk_count: number;

  /** SHA-256 of the cleaned page's content — used for update detection */
  source_hash: string;
}