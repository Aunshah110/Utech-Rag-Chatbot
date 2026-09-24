// app/api/chat/route.ts
import { retrieve } from '@/lib/rag/retrieve';
import { streamAnswer } from '@/lib/rag/stream';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
}

export async function POST(req: Request): Promise<Response> {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');

  if (!lastUser || typeof lastUser.content !== 'string' || !lastUser.content.trim()) {
    return new Response(
      JSON.stringify({ error: 'No user message provided' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const query = lastUser.content.trim();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      try {
        const retrieval = await retrieve(query);

        send('metadata', {
          confident: retrieval.confident,
          reason: retrieval.reason,
          diagnostics: retrieval.diagnostics,
        });

        if (!retrieval.confident) {
          const refusal =
            "I don't have enough information about that in the university's published materials.";
          send('text', { delta: refusal });
          send('sources', { sources: [] });
          send('done', {});
          controller.close();
          return;
        }

        const sources = await streamAnswer(query, retrieval, (delta) => {
          send('text', { delta });
        });

        send('sources', { sources });
        send('done', {});
        controller.close();
      } catch (err: any) {
        send('error', { message: err?.message ?? 'Unknown error' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}