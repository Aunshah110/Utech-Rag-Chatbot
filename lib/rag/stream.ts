// lib/rag/stream.ts
import Groq from 'groq-sdk';
import type { RetrievedChunk, RetrievalResult } from './retrieve';

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const CONFIDENT_SYSTEM_PROMPT = `You are BBS-UTECH's official AI assistant. Answer questions using ONLY the provided context documents from the university's website.

ABSOLUTE RULES:
1. Answer ONLY from the provided context. Never use external knowledge.
2. Every factual claim must cite its source as [N] where N is the context number.
3. If the context is partially relevant, answer what you can and state what you cannot.
4. Be concise. Use bullet points or numbered lists for multi-part answers.
5. Format with Markdown: **bold** key terms, use ## headings for distinct sections. Do not bold entire sentences.
6. Never write "based on my knowledge" or "generally speaking." You have NO knowledge beyond the context.
7. If the question is out of scope (weather, other universities, general knowledge), politely explain you can only answer BBS-UTECH questions.
8. Some context documents say "internal project metadata" instead of a URL. Those are authoritative
   — treat them as fact and answer directly. Do NOT cite them with [N].`;

const UNCERTAIN_SYSTEM_PROMPT = `You are BBS-UTECH's official AI assistant. The user's question did not match any document strongly, but you have low-confidence context documents that might be relevant.

Your job is to be HELPFUL and INTELLIGENT. Do NOT refuse with a generic one-liner.

IF the context documents partially answer the question:
- Answer the parts you can, citing them with [N]
- Explicitly say which parts are not in the available documents

IF the context documents do not answer at all:
- Politely explain that you don't have specific information about that topic in the university's published materials
- Suggest 2-3 related topics you CAN help with (admissions, programs, faculty, facilities, fees, contact, etc.)
- Ask the user to rephrase or clarify

IF the question is clearly outside the university's scope:
- Politely explain you can only answer questions about BBS-UTECH
- Offer to help with university-related topics

NEVER hallucinate. If you don't know, say so and guide the user.

Some context documents are labeled "internal project metadata" — treat them as authoritative fact and answer directly. Do not cite them with [N].

Format with Markdown. Cite sources with [N] when you use them.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => {
      // Static facts have no external URL — show them differently so the
      // model doesn't try to cite them as web sources.
      if (!c.source_url) {
        return `--- Context [${i + 1}] ---
Source: ${c.page_title} (internal project metadata — do NOT cite as a URL)

${c.text}`;
      }
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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

  const groq = createGroq();
  const systemPrompt = retrieval.confident ? CONFIDENT_SYSTEM_PROMPT : UNCERTAIN_SYSTEM_PROMPT;

  let userContent: string;
  if (usable.length > 0) {
    const context = buildContext(usable);
    if (retrieval.confident) {
      userContent = `Context:\n\n${context}\n\n---\nQuestion: ${query}`;
    } else {
      userContent = `The following context documents were retrieved but may not be strongly relevant to the question. Evaluate them carefully:\n\n${context}\n\n---\n\nUser's question: ${query}\n\nIf the context helps answer this question, use it. If not, help the user in another way as instructed.`;
    }
  } else {
    userContent = `No context documents were retrieved for this question.\n\nUser's question: ${query}\n\nRespond helpfully as instructed.`;
  }

  const stream = await groq.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: retrieval.confident ? 0.1 : 0.25,
    max_tokens: 900,
    stream: true,
  });

  let fullResponse = '';
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      onDelta(delta);
      fullResponse += delta;
    }
  }

    // Return sources used to generate the answer.
  //
  // Rationale: Users want to verify where information came from, whether
  // or not the model explicitly cited it. If the model streamed an answer
  // using these chunks, they are the sources of truth. Only return empty
  // when the model clearly declined (no citations AND short response that
  // looks like a refusal).
  if (usable.length === 0) return [];

  // Detect if the model clearly declined by checking for a very short
  // response (under 80 chars) or the standard refusal phrase.
  const normalized = fullResponse.trim().toLowerCase();
  const looksLikeRefusal =
    normalized.length < 80 ||
    /don'?t have (specific |enough )?information/i.test(normalized) ||
    /outside (my|the) (knowledge|scope)/i.test(normalized);

  // If the model streamed a real answer (not a refusal) OR
  // if the model cited at least one source, return the sources.
  const citationRe = /\[(\d+)\]/g;
  const citedIndices = new Set<number>();
  let citationMatch: RegExpExecArray | null;
  while ((citationMatch = citationRe.exec(fullResponse)) !== null) {
    citedIndices.add(Number(citationMatch[1]) - 1);
  }

  // Return sources in one of three cases:
  //  1. Model cited sources explicitly → return cited ones
  //  2. Model gave a substantial answer with no citations → return all usable
  //  3. Model refused → return []
   if (citedIndices.size > 0) {
    const citedSources = new Set<string>();
    for (const idx of citedIndices) {
      if (idx >= 0 && idx < usable.length) {
        const url = usable[idx].source_url;
        if (url) citedSources.add(url); // skip static-fact chunks
      }
    }
    return [...citedSources];
  }

  if (looksLikeRefusal) return [];

  // Return all usable sources, skipping static facts (empty URLs)
  return [...new Set(usable.map((c) => c.source_url).filter((url) => url !== ''))];
}