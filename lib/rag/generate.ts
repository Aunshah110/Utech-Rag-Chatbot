const SYSTEM_PROMPT = `You are a university information assistant for BBS-UTECH (BBS University of Technology and Skill Development). Your ONLY job is to answer questions using the provided context documents.

ABSOLUTE RULES — breaking these is a critical failure:

1. Answer ONLY from the provided context. If the context does not contain the answer, respond exactly: "I don't have information about that in the university's published materials."

2. Every factual claim MUST cite its source using the format [chunk_id]. Example: "The BS Computer Science program requires 4 years of study [abc123-2]."

3. Never infer, assume, extrapolate, or combine information beyond what is explicitly stated in the context.

4. If the context is partially relevant, state what you can answer and explicitly say what you cannot.

5. If the user asks about topics unrelated to BBS-UTECH (weather, general knowledge, other universities), respond: "I can only answer questions about BBS-UTECH based on the university's published information."

6. Do not apologize excessively. Be concise. Users want facts, not pleasantries.

7. If the context contains conflicting information, state the conflict explicitly and cite both sources.

8. Do NOT use phrases like "based on my knowledge" or "generally speaking." You have NO knowledge beyond the provided context.

Your answer should be 2-5 sentences unless the question requires a list. Include the source URLs when the user needs to verify or take action.`;

function buildContextPrompt(chunks: RetrievedChunk[]): string {
  const contextBlocks = chunks.map((c, i) => {
    return `--- Context ${i + 1} ---
Source URL: ${c.source_url}
Page Title: ${c.page_title}
Section: ${c.heading_path || '(none)'}
Content Type: ${c.content_type}
Relevance Score: ${c.rerank_score?.toFixed(3) ?? c.vector_score.toFixed(3)}

${c.text}`;
  }).join('\n\n');

  return `Based on the following context documents from the BBS-UTECH website, answer the user's question. Cite sources using [chunk_id] format.

${contextBlocks}`;
}

import Groq from 'groq-sdk';
import { RetrievalResult, retrieve, RetrievedChunk } from './retrieve';
import { ConfigValidationError } from '../utils/errors';




function createGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new ConfigValidationError('GROQ_API_KEY is not set');
  return new Groq({ apiKey });
}

export async function generate(
  query: string,
  retrieval: RetrievalResult
): Promise<{ answer: string; refused: boolean; sources: string[] }> {
  // GUARDRAIL 1: Refuse if retrieval not confident
  if (!retrieval.confident) {
    return {
      answer: "I don't have enough information about that in the university's published materials.",
      refused: true,
      sources: [],
    };
  }

  // GUARDRAIL 2: Bound context size (avoid Jevons token explosion)
  const MAX_CONTEXT_TOKENS = 4000;
  let totalTokens = 0;
  const usableChunks: RetrievedChunk[] = [];
  for (const c of retrieval.chunks) {
    if (totalTokens + c.token_count > MAX_CONTEXT_TOKENS) break;
    usableChunks.push(c);
    totalTokens += c.token_count;
  }

  if (usableChunks.length === 0) {
    return {
      answer: "I don't have enough information about that in the university's published materials.",
      refused: true,
      sources: [],
    };
  }

  const contextPrompt = buildContextPrompt(usableChunks);
  const groq = createGroqClient();

  // GUARDRAIL 3: ONE call, no retries
  try {
    const response = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${contextPrompt}\n\n---\nUser Question: ${query}` },
      ],
      temperature: 0.1,  // Low temperature for factual accuracy
      max_tokens: 800,
    });

    const answer = response.choices[0]?.message?.content ?? '';
    if (!answer.trim()) {
      return {
        answer: "I encountered an error generating a response. Please try again.",
        refused: true,
        sources: [],
      };
    }

    return {
      answer,
      refused: false,
      sources: usableChunks.map(c => c.source_url),
    };
  } catch (err: any) {
    console.error('Groq generation failed', { error: err?.message });
    return {
      answer: "I encountered an error generating a response. Please try again.",
      refused: true,
      sources: [],
    };
  }
}

if (require.main === module) {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) {
    console.error('Usage: npx ts-node scripts/generate.ts "your question"');
    process.exit(1);
  }

  (async () => {
    const retrieval = await retrieve(query);
    console.log('Retrieval confident:', retrieval.confident);
    
    const result = await generate(query, retrieval);
    console.log('\n' + '='.repeat(72));
    console.log('ANSWER:');
    console.log(result.answer);
    if (result.sources.length > 0) {
      console.log('\nSOURCES:');
      for (const s of [...new Set(result.sources)]) console.log('  -', s);
    }
  })();
}