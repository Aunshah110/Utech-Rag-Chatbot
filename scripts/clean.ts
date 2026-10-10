// scripts/clean.ts
// CLI wrapper — all logic lives in lib/pipeline/clean.ts

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env' });

import { cleanAll } from '../lib/pipeline/clean';
import { createLogger } from '../lib/utils/logger';

const log = createLogger('clean-cli');

if (require.main === module) {
  cleanAll({
    inputDir: process.env.CLEAN_INPUT_DIR,
    outputDir: process.env.CLEAN_OUTPUT_DIR,
  })
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((err) => {
      log.error('Fatal clean error', {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    });
}