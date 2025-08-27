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

export type ModelKey = keyof typeof AVAILABLE_MODELS;
