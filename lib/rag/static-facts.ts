// lib/rag/static-facts.ts
// Authoritative, non-crawled knowledge that the assistant should always
// have access to. Kept separate from the vector store so it never pollutes
// retrieval and is always accurate.

export interface StaticFact {
  id: string;
  /** Keywords/phrases that trigger this fact's inclusion */
  triggers: string[];
  /** The content injected into the prompt when triggered */
  content: string;
  /** Optional: URL to cite (leave undefined for facts that aren't sourced) */
  sourceUrl?: string;
  sourceTitle?: string;
  /**
   * Priority — when multiple facts match the same query, higher priority
   * facts suppress lower priority ones if they belong to the same group.
   * Set to control which facts "win" when both team info and individual
   * info match.
   */
  priority?: number;
  /**
   * Group — facts in the same group are mutually exclusive by default.
   * If a specific-developer fact matches, a group fact is suppressed.
   */
  group?: string;
}

export const STATIC_FACTS: StaticFact[] = [
  // -------------------------------------------------------------------------
  // Specific developer — Syed Aun Muhammad
  // -------------------------------------------------------------------------
  {
    id: 'developer-syed-aun',
    group: 'developer',
    priority: 10, // beats team-level facts when both match
    triggers: [
      'syed aun', 'aun muhammad', 'aun muhammad', 'aun', 'syed aun muhammad',
      'kazmi', 'aun shah', 'syed aun shah', 'syed aun kazmi', 'who is aun',
      'about aun', 'about syed aun', 'Team lead',
      'lead ai developer', 'lead developer', 'ai developer',
      'who is syed', 'about syed',
      'who made the ai', 'who built the ai',
      'backend developer', 'system designer', 'architecture',
    ],
    content: `**Syed Aun Muhammad** is the Lead AI Developer for this chatbot.

Profile:
- **Name:** Syed Aun Muhammad
- **Program:** BS Artificial Intelligence, Batch 2023
- **Institution:** BBS-UTECH (BBS University of Technology and Skill Development), Khairpur Mirs
- **Role:** Lead AI Developer

Contributions:
- Backend architecture and implementation
- Overall system design
- Vector database setup and management
- RAG pipeline workflows: retrieval, embedding, reranking, and generation
- Data ingestion pipeline: crawling, cleaning, chunking, and incremental backfill

Contact: aun.23ai20@gmail.com

When a user asks specifically about Syed Aun Muhammad, answer using ONLY this information. Do not mention other team members unless the user asks about the team or the project overall.`,
    sourceTitle: 'Team Information — Syed Aun Muhammad',
  },

  // -------------------------------------------------------------------------
  // Specific developer — Muhammad Abbas
  // -------------------------------------------------------------------------
  {
    id: 'developer-abbas',
    group: 'developer',
    priority: 10,
    triggers: [
      'abbas', 'muhammad abbas', 'm abbas', 
      'frontend developer', 'ui developer', 'ux developer',
      'who is abbas', 'about abbas',
      'who made the frontend', 'who built the frontend',
      'who designed the ui', 'who designed the interface',
    ],
    content: `**Muhammad Abbas** is the Frontend Developer for this chatbot.

Profile:
- **Name:** Muhammad Abbas
- **Program:** BS Artificial Intelligence, Batch 2023
- **Institution:** BBS-UTECH (BBS University of Technology and Skill Development), Khairpur Mirs
- **Role:** Frontend Developer

Contributions:
- User interface (UI) design
- User experience (UX) design
- Frontend implementation
- Worked as part of the team led by Syed Aun Muhammad

Contact: abbas.23ai08@bbsutsd.edu.pk

When a user asks specifically about Muhammad Abbas, answer using ONLY this information. Do not mention other team members unless the user asks about the team or the project overall.`,
    sourceTitle: 'Team Information — Muhammad Abbas',
  },

  // -------------------------------------------------------------------------
  // Both developers — team-level fact
  // -------------------------------------------------------------------------
  {
    id: 'developer-team',
    group: 'developer',
    priority: 5, // lower priority; suppressed when a specific dev matches
    triggers: [
      'who developed', 'who created', 'who built', 'who made',
      'developers', 'the developers', 'team', 'the team',
      'who is behind', 'who is responsible',
      'project team', 'development team',
      'who developed this', 'who built this', 'who created this',
      'who developed this chatbot', 'who created this chatbot',
      'who developed the chatbot', 'who built the chatbot',
    ],
    content: `This chatbot was developed by a two-person team of BS Artificial Intelligence students (Batch 2023) at BBS-UTECH, Khairpur Mirs.

**Syed Aun Muhammad** — Lead AI Developer
- Backend architecture and implementation
- Overall system design
- Vector database setup and management
- RAG pipeline workflows (retrieval, embedding, reranking, generation)
- Data ingestion: crawling, cleaning, chunking, incremental backfill
- Contact: aun.23ai20@gmail.com

**Muhammad Abbas** — Frontend Developer
- User interface (UI) design
- User experience (UX) design
- Frontend implementation
- Contact: abbas.23ai08@bbsutsd.edu.pk

Team structure: Abbas contributed to the project under the team led by Syed Aun Muhammad.

When a user asks about the project developers as a team, provide both members' information.`,
    sourceTitle: 'Team Information — Development Team',
  },

  // -------------------------------------------------------------------------
  // Project metadata
  // -------------------------------------------------------------------------
  {
    id: 'project-info',
    group: 'project',
    priority: 5,
    triggers: [
      'final year project', 'fyp', 'capstone',
      'about this project', 'what is this project',
      'how was this built', 'tech stack', 'what technology',
      'what tools', 'architecture', 'how does this work',
    ],
    content: `This is a final-year academic project titled "RAG-Based University Assistant" developed by Syed Aun Muhammad and Muhammad Abbas.

Technical architecture:
- Frontend & API: Next.js 15, deployed on Vercel
- Embeddings: Cohere Embed v3 (embed-english-v3.0, 1024 dimensions)
- Reranking: Cohere Rerank v3.5
- Vector store: Upstash Vector
- Generation: Groq (openai/gpt-oss-120b)
- Data refresh: sitemap-driven incremental backfill with content hashing

Design principles:
- Zero-hallucination grounding — answers come only from retrieved context
- Source citations — every factual claim links to a source
- Dual confidence gates — vector similarity and rerank score must both pass
- Soft refusal — the model asks for clarification instead of refusing blindly`,
    sourceTitle: 'Project Information',
  },

  // -------------------------------------------------------------------------
  // Generic assistant identity — "who are you"
  // -------------------------------------------------------------------------
  {
    id: 'assistant-identity',
    group: 'project',
    priority: 3,
    triggers: [
      'who are you', 'what are you', 'your name',
      'are you a bot', 'are you an ai', 'are you human',
      'what can you do', 'what do you do',
    ],
    content: `I am the BBS-UTECH Assistant, an AI chatbot designed to answer questions about BBS University of Technology and Skill Development using only the university's published website content.

I can help with:
- Admissions and application procedures
- Undergraduate and postgraduate programs
- Faculty and department information
- Facilities (hostel, transport, sports)
- Fee structures and important dates
- Contact information and university news

I was developed by Syed Aun Muhammad and Muhammad Abbas as an academic project.

I only answer questions related to BBS-UTECH. If a question is outside that scope, I'll let you know politely.`,
    sourceTitle: 'Assistant Identity',
  },
];