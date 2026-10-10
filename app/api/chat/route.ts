// app/api/chat/route.ts
import { retrieve } from '@/lib/rag/retrieve';
import { streamAnswer } from '@/lib/rag/stream';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function POST(req: Request): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const messages: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');

  if (!lastUser || typeof lastUser.content !== 'string' || !lastUser.content.trim()) {
    return new Response(JSON.stringify({ error: 'No user message provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const query = lastUser.content.trim();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const retrieval = await retrieve(query);

        send('metadata', {
          confident: retrieval.confident,
          reason: retrieval.reason,
          diagnostics: retrieval.diagnostics,
        });

        // Always stream — the model decides how to respond
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