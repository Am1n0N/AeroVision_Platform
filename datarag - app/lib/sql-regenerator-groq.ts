// lib/sql-regenerator-groq.ts
import { ChatGroq } from "@langchain/groq";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { registerSqlRegenerator } from "@/lib/database-tools";



export function wireGroqSqlRegenerator(groqmodel: string) {
  registerSqlRegenerator(async ({ prompt }) => {
    // If the key is missing, let the tool fall back to its default SQL
    if (!process.env.GROQ_API_KEY) return null;

    const model = new ChatGroq({
      apiKey: process.env.GROQ_API_KEY!,
      model: groqmodel,
      temperature: 0,
      maxTokens: 1024,
    });

    // The prompt already instructs “JSON only: {"query":"..."}”
    const res = await model.invoke([
      new SystemMessage("Return JSON only as requested. No prose, no code fences."),
      new HumanMessage(prompt),
    ]);

    return String(res.content ?? "");
  });
}
