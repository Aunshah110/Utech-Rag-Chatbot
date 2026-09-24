// types/chat.ts

export type MessageRole = 'user' | 'assistant';

export interface SourceCitation {
  url: string;
  title: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  sources?: SourceCitation[];
  isRefusal?: boolean;
  isStreaming?: boolean;
  error?: string;
  diagnostics?: {
    confident: boolean;
    reason?: string;
    vector_top_score?: number;
    rerank_top_score?: number | null;
    elapsed_ms?: number;
  };
}