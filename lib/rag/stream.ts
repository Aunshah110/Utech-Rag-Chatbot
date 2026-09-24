// lib/rag/stream.ts
import Groq from 'groq-sdk';
import type { RetrievedChunk, RetrievalResult } from './retrieve';

const SYSTEM_PROMPT = `You are a university information assistant for BBS-UTECH. Answer ONLY from the provided context.

ABSOLUTE RULES:
1. If the context does not contain the answer, respond exactly: "I don't have information about that in the university's published materials."
2. Every factual claim must cite its source as [N] where N is the context number.
3. Never infer, assume, or extrapolate beyond the context.
4. Be concise — 2-5 sentences unless a list is required.
5. Do NOT use phrases like "based on my knowledge" or "generally speaking."`;

function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => {
      return `--- Context [${i + 1}] ---
Source URL: ${c.source_url}
Page Title: ${c.page_title}
Section: ${c.heading_path || '(none)'}

${c.text}`;
    })
    .join('\n\n');
}

function createGroq(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');
  return new Groq({ apiKey });
}

export async function streamAnswer(
  query: string,
  retrieval: RetrievalResult,
  onDelta: (delta: string) => void
): Promise<string[]> {
  const MAX_TOKENS = 4000;
  let used = 0;
  const usable: RetrievedChunk[] = [];
  for (const c of retrieval.chunks) {
    if (used + c.token_count > MAX_TOKENS) break;
    usable.push(c);
    used += c.token_count;
  }

  const context = buildContext(usable);
  const groq = createGroq();

  const stream = await groq.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Context:\n\n${context}\n\n---\nQuestion: ${query}`,
      },
    ],
    temperature: 0.1,
    max_tokens: 800,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) onDelta(delta);
  }

  return [...new Set(usable.map((c) => c.source_url))];
}