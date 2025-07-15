import dotenv from "dotenv";
import { StreamingTextResponse } from "ai";
import { currentUser } from "@clerk/nextjs";
import { NextResponse } from "next/server";
import { ChatOllama } from "@langchain/ollama";
import { HumanMessage } from "@langchain/core/messages";
import { MemoryManager } from "@/lib/memory";
import { rateLimit } from "@/lib/rate-limit";
import prismadb from "@/lib/prismadb";

dotenv.config({ path: `.env` });

export async function POST(
  request: Request,
  { params }: { params: { chatId: string } }
) {
  try {
    const { prompt } = await request.json();
    const user = await currentUser();

    if (!user || !user.firstName || !user.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const identifier = request.url + "-" + user.id;
    const { success } = await rateLimit(identifier);
    if (!success) {
      return new NextResponse("Rate limit exceeded", { status: 429 });
    }

    const document = await prismadb.document.update({
      where: { id: params.chatId },
      data: {
        messages: {
          create: {
            content: prompt,
            role: "USER",
            userId: user.id,
          },
        },
      },
    });

    if (!document) {
      return new NextResponse("Document not found", { status: 404 });
    }

    const memoryManager = await MemoryManager.getInstance();
    const documentKey = {
      documentName: document.id,
      userId: user.id,
      modelName: "deepseek-r1:8b",
    };

    await memoryManager.writeToHistory("User: " + prompt + "\n", documentKey);

    const recentChatHistory = await memoryManager.readLatestHistory(documentKey);
    const similarChat = await memoryManager.vectorSearch(recentChatHistory, document.id, true);
    const recentDocContent = await memoryManager.vectorSearch(prompt, document.id, false);

    const relevantChatHistory = similarChat?.map(doc => doc.pageContent).join("\n") ?? "";
    const relevantDocContent = recentDocContent?.map(doc => doc.pageContent).join("\n") ?? "";

    const model = new ChatOllama({
      baseUrl: "http://localhost:11434",
      model: "deepseek-r1:7b",
      temperature: 0.2,
      streaming: true,
    });

    model.verbose = true;

    const stream = await model.stream([
      new HumanMessage(`
        AI Task: Based on the context provided, respond to the user's query while utilizing the relevant document references and chat history.
        Reply with answers that range from one sentence to one paragraph, with some details/references to the original document.

        Document Title: ${document.title}
        Document Description: ${document.description}

        User: ${user.firstName} ${user.lastName}

        Relevant Document References:
        ${relevantDocContent}

        ${relevantChatHistory}

        Query:
        ${prompt}

        AI Response:
      `)
    ]);

    let finalResponse = "";
    const readableStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let finalResponse = "";
        for await (const chunk of stream) {
          const text = chunk.content ?? "";
          controller.enqueue(encoder.encode(text));
          finalResponse += text;
        }
        controller.close();

        if (finalResponse.length > 1) {
          await prismadb.document.update({
            where: { id: params.chatId },
            data: {
              messages: {
                create: {
                  content: finalResponse,
                  role: "SYSTEM",
                  userId: user.id,
                },
              },
            },
          });
          await memoryManager.writeToHistory("System: " + finalResponse, documentKey);
        }
      }
    });


    return new StreamingTextResponse(readableStream);
  } catch (error) {
    console.error("[Chat.POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
