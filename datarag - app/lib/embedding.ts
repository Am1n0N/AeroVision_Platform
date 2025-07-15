import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";

export async function getEmbeddings(text: string) {
  try {
    const embeddings = new HuggingFaceInferenceEmbeddings({
      apiKey: process.env.HUGGINGFACEHUB_API_KEY,
      model: "sentence-transformers/all-MiniLM-L6-v2",
      provider: "hf-inference",  // or "huggingface_hub"
    });


    const embeddingsResponse = await embeddings.embedDocuments([text]);
    console.log("Embeddings response", embeddingsResponse);
    return embeddingsResponse;
  } catch (error) {
    console.error("Error getting embeddings", error);
    throw error;
  }
}
