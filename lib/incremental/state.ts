// lib/incremental/state.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';

const log = createLogger('state');

const STATE_DIR = 'data/state';
const SNAPSHOT_FILE = path.join(STATE_DIR, 'sitemap-snapshot.json');
const METADATA_FILE = path.join(STATE_DIR, 'last-run.json');

export interface UrlState {
  url: string;
  lastmod?: string;
  lastModified?: string;  
  contentHash?: string;
  lastFetchedAt: string;
}

export interface StateSnapshot {
  version: number;              // schema version
  generatedAt: string;
  urls: Record<string, UrlState>; // keyed by URL
}

export interface RunMetadata {
  startedAt: string;
  finishedAt: string;
  pagesAdded: number;
  pagesUpdated: number;
  pagesRemoved: number;
  pagesSkipped: number;
  totalUrls: number;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadSnapshot(): StateSnapshot {
  if (!existsSync(SNAPSHOT_FILE)) {
    log.info('No snapshot found — treating as first run');
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      urls: {},
    };
  }

  try {
    const raw = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf-8'));
    if (raw.version !== 1) {
      log.warn('Snapshot version mismatch — treating as first run', {
        found: raw.version,
      });
      return { version: 1, generatedAt: new Date().toISOString(), urls: {} };
    }
    return raw;
  } catch (err: any) {
    log.warn('Snapshot corrupted — treating as first run', {
      error: err?.message,
    });
    return { version: 1, generatedAt: new Date().toISOString(), urls: {} };
  }
}

export function saveSnapshot(snapshot: StateSnapshot): void {
  ensureDir(STATE_DIR);
  snapshot.generatedAt = new Date().toISOString();
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf-8');
  log.info('Snapshot saved', { urlCount: Object.keys(snapshot.urls).length });
}

export function loadMetadata(): RunMetadata | null {
  if (!existsSync(METADATA_FILE)) return null;
  try {
    return JSON.parse(readFileSync(METADATA_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveMetadata(meta: RunMetadata): void {
  ensureDir(STATE_DIR);
  writeFileSync(METADATA_FILE, JSON.stringify(meta, null, 2), 'utf-8');
}