import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { Document, RecursiveCharacterTextSplitter } from "@pinecone-database/doc-splitter";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";
import { HuggingFaceInferenceEmbeddings  } from "@langchain/community/embeddings/hf";
import { truncateStringByBytes } from "./truncate";

// Define a type for PDF pages
type PDFPage = {
  pageContent: string;
  metadata: {
    loc: {
      pageNumber: number;
    };
  };
};

// Function to load a PDF file, split it into chunks, and store the vectors in Pinecone
export async function loadFile(fileUrl: string, documentId: string) {
  if (!fileUrl) throw new Error("fileUrl is required");

  const response = await fetch(fileUrl);
  const buffer = await response.arrayBuffer();
  const blob = new Blob([buffer]);
  const loader = new PDFLoader(blob);
  const pages = await loader.load() as PDFPage[];

  // Split and vectorize pages
  const docsChunks = await Promise.all(pages.map(prepareDocument));

  // Initialize Pinecone
  const client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const pineconeIndex = client.Index(process.env.PINECONE_INDEX!);

  // Use Hugging Face embeddings via LangChain
  const embeddings = new HuggingFaceInferenceEmbeddings({
    apiKey: process.env.HUGGINGFACEHUB_API_KEY!,
    model: process.env.HF_EMBEDDING_MODEL || "sentence-transformers/all-MiniLM-L6-v2",
  });

  const vectorStore = await PineconeStore.fromExistingIndex(
    embeddings,
    { pineconeIndex }
  ); // Supports Pinecone via LangChain-js :contentReference[oaicite:1]{index=1}

  const added = await vectorStore.addDocuments(docsChunks.flat(), {
    namespace: documentId,
  });

  console.log("Stored vectors:", added);
  return added;
}

// Prepare a single page into LLM-ready chunks
async function prepareDocument(page: PDFPage) {
  let text = page.pageContent.replace(/\n/g, " ");
  const splitter = new RecursiveCharacterTextSplitter();
  const docs = await splitter.splitDocuments([
    new Document({
      pageContent: text,
      metadata: {
        pageNumber: page.metadata.loc.pageNumber,
        text: truncateStringByBytes(text, 36000),
        userMsg: false,
      },
    }),
  ]);
  return docs;
}
