// config/models.ts

export const AVAILABLE_MODELS_LIST = [
  "llama-3.1-405b-reasoning",
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
  "llama3-70b-8192",
  "llama3-8b-8192",
  "gemma2-9b-it",
  "gemma-7b-it",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "whisper-large-v3",
  "whisper-large-v3-turbo",
  "qwen/qwen3-32b",
] as const;

export const AVAILABLE_MODELS = {
  "llama-3.1-405b-reasoning": {
    name: "Llama 3.1 405B (Reasoning)",
    temperature: 0.2,
    contextWindow: 131072,
  },
  "llama-3.1-70b-versatile": {
    name: "Llama 3.1 70B (Versatile)",
    temperature: 0.2,
    contextWindow: 131072,
  },
  "llama-3.1-8b-instant": {
    name: "Llama 3.1 8B (Instant)",
    temperature: 0.2,
    contextWindow: 131072,
  },
  "llama3-70b-8192": {
    name: "Llama 3 70B",
    temperature: 0.2,
    contextWindow: 8192,
  },
  "llama3-8b-8192": {
    name: "Llama 3 8B",
    temperature: 0.2,
    contextWindow: 8192,
  },
  "gemma2-9b-it": {
    name: "Gemma 2 9B Instruct",
    temperature: 0.2,
    contextWindow: 8192,
  },
  "gemma-7b-it": {
    name: "Gemma 7B Instruct",
    temperature: 0.2,
    contextWindow: 8192,
  },
  "openai/gpt-oss-20b": {
    name: "GPT-OSS 20B",
    temperature: 0.2,
    contextWindow: 131072,
  },
  "openai/gpt-oss-120b": {
    name: "GPT-OSS 120B",
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
  "qwen/qwen3-32b": {
    name: "Qwen 3 32B",
    temperature: 0.2,
    contextWindow: 131072,
  }
} as const;

const EVAL_MODELS = {
      base: [
        { id: "groq/llama-3.1-70b-versatile", name: "Llama 3.1 70B Versatile", provider: "Groq", contextWindow: 32768 },
        { id: "groq/llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", provider: "Groq", contextWindow: 32768 },
        { id: "groq/mixtral-8x7b-32768", name: "Mixtral 8x7B", provider: "Groq", contextWindow: 32768 },
        { id: "groq/llama-guard-3-8b", name: "Llama Guard 3 8B", provider: "Groq", contextWindow: 8192 },
        { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", provider: "OpenAI", contextWindow: 131072 },
        { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", provider: "OpenAI", contextWindow: 131072 },
        { id: "gemma2-9b-it", name: "Gemma 2 9B Instruct", provider: "Mistral", contextWindow: 8192 },
        { id: "gemma-7b-it", name: "Gemma 7B Instruct", provider: "Mistral", contextWindow: 8192 },
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
