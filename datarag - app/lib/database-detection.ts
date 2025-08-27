// lib/database-detection.ts
import { ChatOllama } from "@langchain/ollama";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export const DATABASE_INTENT_PROMPT = `
You are an expert at classifying user queries related to aviation. Your task is to determine if the query intends a database lookup for specific aviation data, such as flights, airlines, airports, or metrics like passenger traffic, delays, rankings, or statistics.

Key guidelines:
- True if the query asks for specific factual data, lists, rankings, or statistics that would typically come from a database (e.g., "top airports by passengers", "flight delays at LAX", "airline routes").
- False if it's general knowledge, principles, opinions, how-to guides, history, or non-data-driven questions (e.g., "how airplanes fly", "best travel tips", "future of aviation").
- Consider context: Queries needing real-time or historical data points are likely DB queries.
- Ambiguous cases: Lean towards true if it could involve data retrieval, but adjust confidence accordingly.
- Output strictly valid JSON only: {"isDbQuery": boolean, "confidence": number between 0 and 1, "reasoning": string (brief explanation)}.

Examples:
- "Top 10 busiest airports": {"isDbQuery": true, "confidence": 0.95, "reasoning": "Requests a ranking based on passenger traffic metrics."}
- "General principles of airport management": {"isDbQuery": false, "confidence": 0.8, "reasoning": "Asks for conceptual knowledge, not specific data."}
- "What is the busiest airport in the world?": {"isDbQuery": true, "confidence": 1.0, "reasoning": "Seeks specific factual ranking from data."}
- "How to book a flight online": {"isDbQuery": false, "confidence": 0.9, "reasoning": "Procedural advice, no data lookup needed."}
- "History of Boeing airlines": {"isDbQuery": false, "confidence": 0.95, "reasoning": "Historical overview, not database metrics."}
- "Average flight delays at JFK in 2023": {"isDbQuery": true, "confidence": 0.98, "reasoning": "Requires statistical data from records."}
- "Best airlines for customer service": {"isDbQuery": true, "confidence": 0.7, "reasoning": "Could be based on metrics like ratings; lower confidence if subjective."}
- "Explain turbulence in flights": {"isDbQuery": false, "confidence": 0.95, "reasoning": "Scientific explanation, not data query."}
`;

const model = new ChatOllama({
  model: "gemma3:1b", // Consider upgrading to a larger model like 'llama3.1:8b' for better accuracy if available in your Ollama setup
  temperature: 0.1, // Low for consistency
  format: "json", // Enforce JSON output for reliability
  baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
});

// Helper to extract and parse JSON from content
function extractJson(content: string): any {
  // Remove any potential wrappers or artifacts
  const cleaned = content
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Attempt to match the first JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Invalid JSON');
  }
}

// Main detection function
export async function isDatabaseQuery(message: string): Promise<{ isDbQuery: boolean; confidence: number }> {
  try {
    const response = await model.invoke([
      new SystemMessage(DATABASE_INTENT_PROMPT),
      new HumanMessage(`Query: "${message}"`),
    ]);
    const parsed = extractJson(response.content as string);
    // Validate and sanitize output
    if (typeof parsed.isDbQuery !== 'boolean' || typeof parsed.confidence !== 'number') {
      throw new Error('Invalid response structure');
    }
    console.log('Detection reasoning:', parsed.reasoning); // Log reasoning for debugging
    return {
      isDbQuery: parsed.isDbQuery,
      confidence: Math.min(1, Math.max(0, parsed.confidence)),
    };
  } catch (error) {
    console.error("LLM intent detection failed:", error);
    // Improved fallback: Default to false with low confidence on error
    return { isDbQuery: false, confidence: 0.1 };
  }
}
