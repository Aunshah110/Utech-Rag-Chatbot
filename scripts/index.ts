import { crawlSite } from './crawl';
import { cleanAll } from './clean';
import { chunkAll, type ChunkManifest } from './chunk';

/**
 * End-to-end ingestion: crawl → clean → chunk.
 * Swap the console logger for Pino/Winston in production.
 */
export async function ingestUniversitySite(seedUrls: string[], allowedDomains?: string[]): Promise<ChunkManifest> {
    const domains = allowedDomains?.length
        ? allowedDomains
        : seedUrls.map((url) => {
              try {
                  const hostname = new URL(url).hostname.toLowerCase();
                  return hostname.replace(/^www\./, '');
              } catch {
                  return '';
              }
          }).filter(Boolean);

    const crawlManifest = await crawlSite({
        seedUrls,
        allowedDomains: domains,
        maxDepth: 2,
        maxPages: 200,
        concurrency: 3,
        delayMs: 500,
        timeoutMs: 15000,
        maxRetries: 3,
        outputDir: 'data/raw',
    });
    console.log(`crawl: ${crawlManifest.pagesFetched} pages`);

    const cleanManifest = await cleanAll({
        inputDir: 'data/raw',
        outputDir: 'data/cleaned',
        minContentLength: 200,
    });
    console.log(`clean: ${cleanManifest.pagesCleaned} documents`);

    const chunkManifest = await chunkAll({
        inputDir: 'data/cleaned',
        outputDir: 'data/chunks',
        maxTokens: 500,
        minTokens: 100,
        overlapTokens: 50,
        encodingName: 'cl100k_base',
    });
    console.log(`chunk: ${chunkManifest.totalChunks} chunks`);

    return chunkManifest;
}

// Example
ingestUniversitySite(['https://www.example.edu']).catch(console.error);