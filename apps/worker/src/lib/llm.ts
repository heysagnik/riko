import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const DEFAULT_BASE_URL = "https://api.mistral.ai/v1";
const DEFAULT_MODEL = "mistral-small-latest";

export function llmConfig(): { baseURL: string; apiKey: string; model: string } {
  return {
    baseURL: process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL,
    apiKey: process.env.LLM_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? DEFAULT_MODEL,
  };
}

export function llmProvider() {
  const { baseURL, apiKey } = llmConfig();
  return createOpenAICompatible({ name: "llm", baseURL, apiKey });
}

export function llmChatModel() {
  const { model } = llmConfig();
  return llmProvider().chatModel(model);
}
