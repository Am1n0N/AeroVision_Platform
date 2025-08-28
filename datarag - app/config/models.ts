// config/models.ts

// ✅ GroqCloud text/STT models available today
// (Production + Preview models from https://console.groq.com/docs/models)

export const AVAILABLE_MODELS_LIST = [
  // Production text models
  "llama-3.1-8b-instant",
  // Preview / additional text models
  "deepseek-r1-distill-llama-70b",
  "qwen/qwen3-32b",

  // GPT-OSS models hosted on GroqCloud (Production)
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
  "qwen/qwen3-32b": {
    name: "Qwen 3 32B",
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


const EVAL_MODELS = {
  base: [
    // Groq Cloud text models
    { id: "groq/llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", provider: "Groq", contextWindow: 131072 },
    { id: "groq/deepseek-r1-distill-llama-70b", name: "DeepSeek R1 Distill Llama 70B", provider: "Groq", contextWindow: 131072 },
    // GPT-OSS (served on GroqCloud)
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", provider: "OpenAI (via Groq)", contextWindow: 131072 },
    { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", provider: "OpenAI (via Groq)", contextWindow: 131072 },
  ],
  embedding: [
    { id: "nomic-embed-text", name: "Nomic Embed Text", dimensions: 768, contextLength: 8192, description: "RAG-tuned local embeddings" },
    { id: "mxbai-embed-large", name: "MxBai Embed Large", dimensions: 1024, contextLength: 512, description: "High-quality semantic search" },
    { id: "snowflake-arctic-embed", name: "Snowflake Arctic Embed", dimensions: 1024, contextLength: 512, description: "Strong retrieval performance" },
    { id: "all-minilm", name: "All MiniLM", dimensions: 384, contextLength: 256, description: "Fast & lightweight" },
  ],
} as const;

export { EVAL_MODELS as EVALUATION_MODELS };

export type ModelKey = keyof typeof AVAILABLE_MODELS;
