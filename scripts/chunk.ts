// scripts/chunk.ts
// CLI wrapper — all logic lives in lib/pipeline/chunk.ts

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env' });

import { chunkAll } from '../lib/pipeline/chunk';
import { createLogger } from '../lib/utils/logger';

const log = createLogger('chunk-cli');

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