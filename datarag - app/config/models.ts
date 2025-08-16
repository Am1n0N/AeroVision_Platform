// config/models.ts
export const AVAILABLE_MODELS = {
  "deepseek-r1:7b": {
    name: "DeepSeek R1 7B",
    temperature: 0.3,
    contextWindow: 8192
  },
  "deepseek-r1:8b": {
    name: "DeepSeek R1 8B",
    temperature: 0.3,
    contextWindow: 8192
  },
  "llama3.2:3b": {
    name: "Llama 3.2 3B",
    temperature: 0.4,
    contextWindow: 4096
  },
  "llama3.2:8b": {
    name: "Llama 3.2 8B",
    temperature: 0.4,
    contextWindow: 8192
  },
  "qwen2.5-coder:7b-instruct": {
    name: "qwen2.5-coder:7b-instruct",
    temperature: 0.0,
    contextWindow: 8192
  },
  "mistral:7b": {
    name: "Mistral 7B",
    temperature: 0.0,
    contextWindow: 8192
  },
} as const;

export type ModelKey = keyof typeof AVAILABLE_MODELS;
