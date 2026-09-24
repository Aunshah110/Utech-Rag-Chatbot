/**
 * errors.ts
 *
 * Stage-specific error classes. Using distinct classes (rather than plain
 * Error or string codes) lets callers/QA distinguish "the site was
 * unreachable" from "the HTML was malformed" from "chunking produced an
 * invalid result" via `instanceof`, and preserves the original cause for
 * debugging.
 */

export class PipelineError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
        super(message);
        this.name = new.target.name;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class EmbedError extends PipelineError { }
export class CrawlError extends PipelineError { }
export class CleanError extends PipelineError { }
export class ChunkError extends PipelineError { }

/** Thrown when a config object fails schema validation at a stage boundary. */
export class ConfigValidationError extends PipelineError { }