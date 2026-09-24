/**
 * logger.ts
 *
 * Minimal structured logger. Emits single-line JSON so logs are easy to
 * ingest into any log aggregator (CloudWatch, Datadog, etc.) in production,
 * while staying readable in a local terminal.
 *
 * Usage:
 *   const log = createLogger('crawl');
 *   log.info('Fetched page', { url });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
    debug: (message: string, meta?: Record<string, unknown>) => void;
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

// Configurable via env so production can run at 'info'/'warn' while local
// dev runs at 'debug'. Defaults to 'info'.
const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function log(module: string, level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[currentLevel]) return;

    const entry = {
        timestamp: new Date().toISOString(),
        level,
        module,
        message,
        ...(meta ? { meta } : {}),
    };

    const line = JSON.stringify(entry);
    if (level === 'error' || level === 'warn') {
        console.error(line);
    } else {
        console.log(line);
    }
}

/** Creates a logger tagged with the given module name (e.g. 'crawl', 'clean', 'chunk'). */
export function createLogger(module: string): Logger {
    return {
        debug: (message, meta) => log(module, 'debug', message, meta),
        info: (message, meta) => log(module, 'info', message, meta),
        warn: (message, meta) => log(module, 'warn', message, meta),
        error: (message, meta) => log(module, 'error', message, meta),
    };
}