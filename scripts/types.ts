// types.ts
//  Single source of truth for the data contracts passed between pipeline
//  stages: crawl.ts -> clean.ts -> chunk.ts.

/** A single page as fetched by crawl.ts, before any cleaning/parsing. */
export interface RawPage {
    url: string;
    html: string;
    statusCode: number;
    fetchedAt: string;
    contentType: string;
    depth: number;
}

export interface Heading {
    level: number;
    text: string;
}

export interface ContentBlock {
    type: 'paragraph' | 'list' | 'table';
    content: string;
    headingPath: string[];
}

/** A page after clean.ts has parsed and normalized it. */
export interface CleanedPage {
    url: string;
    title: string;
    headings: Heading[];
    textBlocks: ContentBlock[];
    /** ISO-8601 timestamp of when cleaning was performed. */
    cleanedAt: string;
    /** SHA-256 hash of normalized text content, used for de-duplication. */
    sourceHash: string;
    /** Original crawl depth, carried through for traceability. */
    depth: number;
}

/** A retrieval-ready chunk produced by chunk.ts. */
export interface Chunk {
    id: string;
    pageUrl: string;
    pageTitle: string;
    content: string;
    headingPath: string[];
    chunkIndex: number;
    chunkCount: number;
    tokenCount: number;
    metadata: {
        sourceHash: string;
        createdAt: string;
        [key: string]: unknown;
    };
}