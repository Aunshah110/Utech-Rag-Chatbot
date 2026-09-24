/**
 * tokenizer.ts
 *
 * Thin wrapper around js-tiktoken, isolated in one module so chunk.ts never
 * talks to the tokenizer library directly. If the encoding table fails to
 * load for any reason (e.g. a version mismatch after a dependency bump),
 * we fall back to a conservative character-based estimate rather than
 * crashing the whole pipeline - chunk boundaries would be slightly less
 * precise, but ingestion keeps running and the failure is logged loudly.
 *
 * NOTE: this project pins `js-tiktoken`, a pure-JS tiktoken port (no native
 * bindings, so it works anywhere Node runs). If your team standardizes on
 * a different tokenizer/embedding provider, this is the only file that
 * needs to change - `countTokens` / `encode` / `decode` are the contract
 * the rest of chunk.ts relies on.
 */

import { getEncoding, type Tiktoken } from 'js-tiktoken';
import { createLogger } from './logger';

const log = createLogger('tokenizer');

let encoding: Tiktoken | null = null;
let loadAttempted = false;

function getEncodingSafe(encodingName: string): Tiktoken | null {
    if (loadAttempted) return encoding;
    loadAttempted = true;
    try {
        encoding = getEncoding(encodingName as Parameters<typeof getEncoding>[0]);
    } catch (err) {
        log.error(
            'Failed to load tiktoken encoding, falling back to character-based token estimate. ' +
            'Chunk sizes will be approximate - verify the js-tiktoken dependency/version.',
            { encodingName, error: err instanceof Error ? err.message : String(err) }
        );
        encoding = null;
    }
    return encoding;
}

// Rough average for English prose; used only if the real tokenizer is unavailable.
const FALLBACK_CHARS_PER_TOKEN = 4;

export interface Tokenizer {
    countTokens(text: string): number;
    /** Truncates `text` to at most `maxTokens` tokens, returning the truncated string. */
    truncateToTokens(text: string, maxTokens: number): string;
    /** Returns the last `n` tokens of `text`, decoded back to a string (used for chunk overlap). */
    tailTokens(text: string, n: number): string;
    /** Losslessly splits `text` into consecutive pieces of at most `maxTokens` tokens each. */
    splitIntoTokenChunks(text: string, maxTokens: number): string[];
}

export function createTokenizer(encodingName = 'cl100k_base'): Tokenizer {
    const enc = getEncodingSafe(encodingName);

    if (!enc) {
        const charsPerChunk = FALLBACK_CHARS_PER_TOKEN;
        return {
            countTokens: (text) => Math.ceil(text.length / FALLBACK_CHARS_PER_TOKEN),
            truncateToTokens: (text, maxTokens) => text.slice(0, maxTokens * FALLBACK_CHARS_PER_TOKEN),
            tailTokens: (text, n) => text.slice(-n * FALLBACK_CHARS_PER_TOKEN),
            splitIntoTokenChunks: (text, maxTokens) => {
                const size = maxTokens * charsPerChunk;
                const pieces: string[] = [];
                for (let i = 0; i < text.length; i += size) pieces.push(text.slice(i, i + size));
                return pieces.length > 0 ? pieces : [text];
            },
        };
    }

    return {
        countTokens: (text) => enc.encode(text).length,
        truncateToTokens: (text, maxTokens) => {
            const tokens = enc.encode(text);
            if (tokens.length <= maxTokens) return text;
            return enc.decode(tokens.slice(0, maxTokens));
        },
        tailTokens: (text, n) => {
            const tokens = enc.encode(text);
            if (tokens.length <= n) return text;
            return enc.decode(tokens.slice(-n));
        },
        splitIntoTokenChunks: (text, maxTokens) => {
            const tokens = enc.encode(text);
            const pieces: string[] = [];
            for (let i = 0; i < tokens.length; i += maxTokens) {
                pieces.push(enc.decode(tokens.slice(i, i + maxTokens)));
            }
            return pieces.length > 0 ? pieces : [text];
        },
    };
}