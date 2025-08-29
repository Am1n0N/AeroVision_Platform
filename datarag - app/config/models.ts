// config/models.ts

// ✅ GroqCloud text/STT models available today (you’re actively using these)
export const AVAILABLE_MODELS_LIST = [
  // Production text models
  "llama-3.1-8b-instant",

  // Additional text models on GroqCloud
  "deepseek-r1-distill-llama-70b",

  // GPT-OSS models hosted on GroqCloud
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",

  // Speech-to-text
  "whisper-large-v3",
  "whisper-large-v3-turbo",
] as const;

export const AVAILABLE_MODELS = {
  "llama-3.1-8b-instant": {
    name: "Llama 3.1 8B (Instant)",
    temperature: 0.2,
    contextWindow: 131072,
  },
  "deepseek-r1-distill-llama-70b": {
    name: "DeepSeek R1 Distill Llama 70B",
    temperature: 0.2,
    contextWindow: 131072,
  },
  "openai/gpt-oss-120b": {
    name: "GPT-OSS 120B",
    temperature: 0.2,
    contextWindow: 131072,
  },
  "openai/gpt-oss-20b": {
    name: "GPT-OSS 20B",
    temperature: 0.2,
    contextWindow: 131072,
  },
  "whisper-large-v3": {
    name: "Whisper Large V3",
    temperature: 0.2,
    contextWindow: 0,
  },
  "whisper-large-v3-turbo": {
    name: "Whisper Large V3 Turbo",
    temperature: 0.2,
    contextWindow: 0,
  },
} as const;

// ✅ Pinecone index is 768-dim → keep only 768-dim embedding models
export const EMBEDDING_MODELS = {
  "intfloat/e5-base-v2":          { dimensions: 768, contextLength: 512, description: "E5 base (adds query/passages prefixes)", chunkSize: 256 },
  "Alibaba-NLP/gte-base-en-v1.5": { dimensions: 768, contextLength: 512, description: "GTE base (adds query/passages prefixes)", chunkSize: 256 },
  "BAAI/bge-base-en-v1.5":        { dimensions: 768, contextLength: 512, description: "BGE base (solid baseline)",              chunkSize: 256 },
} as const;

// Used by your evaluation UI: keep base text models and 768-dim embedding models only
const EVAL_MODELS = {
  base: [
    { id: "groq/llama-3.1-8b-instant",            name: "Llama 3.1 8B Instant",        provider: "Groq",               contextWindow: 131072 },
    { id: "groq/deepseek-r1-distill-llama-70b",   name: "DeepSeek R1 Distill Llama 70B", provider: "Groq",             contextWindow: 131072 },
    { id: "openai/gpt-oss-120b",                  name: "GPT-OSS 120B",               provider: "OpenAI (via Groq)",   contextWindow: 131072 },
    { id: "openai/gpt-oss-20b",                   name: "GPT-OSS 20B",                provider: "OpenAI (via Groq)",   contextWindow: 131072 },
  ],
  embedding: [
    { id: "intfloat/e5-base-v2",          name: "E5 Base v2",            dimensions: 768, contextLength: 512, description: "Query/Passage prefixes" },
    { id: "Alibaba-NLP/gte-base-en-v1.5", name: "GTE Base en v1.5",      dimensions: 768, contextLength: 512, description: "Query/Passage prefixes" },
    { id: "BAAI/bge-base-en-v1.5",        name: "BGE Base en v1.5",      dimensions: 768, contextLength: 512, description: "Solid baseline" },
  ],
} as const;

export { EVAL_MODELS as EVALUATION_MODELS };

export type ModelKey = keyof typeof AVAILABLE_MODELS;
