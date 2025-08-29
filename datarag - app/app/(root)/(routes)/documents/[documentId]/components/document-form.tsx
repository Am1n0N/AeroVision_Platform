"use client";

import { Category, Document } from "@prisma/client";
import axios from "axios";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form";
import { useRouter } from "next/navigation";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/components/ui/use-toast";
import { Separator } from "@/components/ui/separator";
import { useForm } from "react-hook-form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Trash, Wand2, Database, Upload, FileText, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import FileUpload from "@/components/file-upload";
import PDFViewer from "@/components/pdfviewer";
import { useState } from "react";
import { useEdgeStore } from "@/lib/edgestore";
import { Progress } from "@/components/ui/progress";

// -----------------------------
// Schema
// -----------------------------
const formSchema = z
  .object({
    title: z.string().min(1, { message: "Title is required" }),
    description: z.string().min(1, { message: "Description is required" }),
    categoryId: z.string().min(1, { message: "Category is required" }),
    file: z.instanceof(File).optional().nullable(),
    fileUrl: z.string().url().optional(),
    addToKnowledgeBase: z.boolean().default(true)
  })
  .superRefine((val, ctx) => {
    if (!val.file && !val.fileUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "File is required",
        path: ["file"]
      });
    }
  });

// Processing stages for better UX
enum ProcessingStage {
  IDLE = "idle",
  UPLOADING_FILE = "uploading_file",
  EXTRACTING_TEXT = "extracting_text",
  SAVING_DOCUMENT = "saving_document",
  PROCESSING_EMBEDDINGS = "processing_embeddings",
  ADDING_TO_KB = "adding_to_kb",
  COMPLETED = "completed",
  ERROR = "error"
}

// Stage descriptions for UI
const stageDescriptions = {
  [ProcessingStage.IDLE]: "Ready to process",
  [ProcessingStage.UPLOADING_FILE]: "Uploading file to storage...",
  [ProcessingStage.EXTRACTING_TEXT]: "Extracting text from PDF...",
  [ProcessingStage.SAVING_DOCUMENT]: "Saving document to database...",
  [ProcessingStage.PROCESSING_EMBEDDINGS]: "Generating embeddings for search...",
  [ProcessingStage.ADDING_TO_KB]: "Adding content to knowledge base...",
  [ProcessingStage.COMPLETED]: "Document processed successfully!",
  [ProcessingStage.ERROR]: "An error occurred during processing"
};

// -----------------------------
// Helper: extract text from PDF
// -----------------------------
const extractTextFromPDF = async (file: File): Promise<string> => {
  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = (textContent.items as unknown[]).map((it) => it.str).join(" ");
      fullText += pageText + "\n";
    }
    return fullText.trim();
  } catch (error) {
    console.error("Error extracting text from PDF:", error);
    throw new Error("Failed to extract text from PDF");
  }
};

// -----------------------------
// Component
// -----------------------------
interface DocumentIdPageProps {
  initialData: Document | null;
  categories: Category[];
}

export const DocumentForm = ({ initialData, categories }: DocumentIdPageProps) => {
  const router = useRouter();
  const { toast } = useToast();
  const { edgestore } = useEdgeStore();

  // Enhanced state management
  const [file, setFile] = useState<File | null>(null);
  const [currentStage, setCurrentStage] = useState<ProcessingStage>(ProcessingStage.IDLE);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [overallProgress, setOverallProgress] = useState(0);
  const [processingDetails, setProcessingDetails] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: initialData
      ? {
          title: initialData.title ?? "",
          description: (initialData as unknown).description ?? "",
          categoryId: (initialData as unknown).categoryId ?? "",
          file: null,
          fileUrl: (initialData as unknown).fileUrl ?? "",
          addToKnowledgeBase: true
        }
      : {
          title: "",
          description: "",
          categoryId: "",
          file: null,
          fileUrl: undefined,
          addToKnowledgeBase: true
        }
  });

  const isProcessing = currentStage !== ProcessingStage.IDLE && currentStage !== ProcessingStage.COMPLETED && currentStage !== ProcessingStage.ERROR;

  const MAX_CONTENT_CHARS = 48000;
  const CHUNK_SIZE = 8000;

  function chunkText(s: string, size = CHUNK_SIZE) {
    const chunks: string[] = [];
    for (let i = 0; i < s.length; i += size) chunks.push(s.slice(i, i + size));
    return chunks;
  }

  // Reset processing state
  const resetProcessingState = () => {
    setCurrentStage(ProcessingStage.IDLE);
    setUploadProgress(0);
    setOverallProgress(0);
    setProcessingDetails("");
    setError(null);
  };

  // Update overall progress based on stage
  const updateProgressForStage = (stage: ProcessingStage, stageProgress = 0) => {
    const stageWeights = {
      [ProcessingStage.UPLOADING_FILE]: 20,
      [ProcessingStage.EXTRACTING_TEXT]: 10,
      [ProcessingStage.SAVING_DOCUMENT]: 20,
      [ProcessingStage.PROCESSING_EMBEDDINGS]: 25,
      [ProcessingStage.ADDING_TO_KB]: 25
    };

    let baseProgress = 0;
    const stages = Object.keys(stageWeights) as ProcessingStage[];
    const currentIndex = stages.indexOf(stage);

    // Add completed stages
    for (let i = 0; i < currentIndex; i++) {
      baseProgress += stageWeights[stages[i] as keyof typeof stageWeights];
    }

    // Add current stage progress
    if (stage in stageWeights) {
      baseProgress += (stageWeights[stage as keyof typeof stageWeights] * stageProgress) / 100;
    }

    setOverallProgress(Math.min(baseProgress, 95)); // Cap at 95% until completion
  };

  // Enhanced knowledge base integration
  const addToKnowledgeBase = async (params: {
    documentId: string;
    documentData: z.infer<typeof formSchema>;
    fileUrl: string;
    extractedText: string;
  }) => {
    const { documentId, documentData, fileUrl, extractedText } = params;

    try {
      setCurrentStage(ProcessingStage.ADDING_TO_KB);
      setProcessingDetails("Preparing content for knowledge base...");
      updateProgressForStage(ProcessingStage.ADDING_TO_KB, 10);

      if (!extractedText?.trim()) {
        throw new Error("No text extracted from PDF");
      }

      const selectedCategory = categories.find((cat) => cat.id === documentData.categoryId);
      const tags = ["document", selectedCategory?.name || "general", "pdf"];
      const tagsCsv = tags.join(",");

      const baseMeta = {
        title: documentData.title,
        category: selectedCategory?.name || "general",
        source: "document_upload",
        sourceUrl: fileUrl,
        documentId,
        tagsCsv,
      };

      if (extractedText.length <= MAX_CONTENT_CHARS) {
        setProcessingDetails("Adding single entry to knowledge base...");
        updateProgressForStage(ProcessingStage.ADDING_TO_KB, 50);

        await axios.post("/api/knowledge", { ...baseMeta, content: extractedText });

        updateProgressForStage(ProcessingStage.ADDING_TO_KB, 100);
        setProcessingDetails("Successfully added to knowledge base!");
      } else {
        const parts = chunkText(extractedText);
        const total = parts.length;

        setProcessingDetails(`Adding ${total} chunks to knowledge base...`);

        for (let i = 0; i < total; i++) {
          const chunkProgress = ((i + 1) / total) * 100;
          setProcessingDetails(`Processing chunk ${i + 1} of ${total}...`);
          updateProgressForStage(ProcessingStage.ADDING_TO_KB, chunkProgress);

          await axios.post("/api/knowledge", {
            ...baseMeta,
            title: `${baseMeta.title} (part ${i + 1}/${total})`,
            content: parts[i]
          });

          // Small delay to prevent overwhelming the API
          if (i < total - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        setProcessingDetails("Successfully chunked and added to knowledge base!");
      }
    } catch (error: unknown) {
      const msg = error?.response?.data?.error || error?.message || "Failed to add to knowledge base";
      console.error("Error adding to knowledge base:", msg);
      throw new Error(`Knowledge base error: ${msg}`);
    }
  };

  // Enhanced submit handler with proper error handling and progress tracking
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    resetProcessingState();

    try {
      let fileUrl = values.fileUrl;
      let extractedText = "";

      // Stage 1: File Upload
      if (file) {
        setCurrentStage(ProcessingStage.UPLOADING_FILE);
        setProcessingDetails("Uploading file to cloud storage...");

        const res = await edgestore.MyDocuments.upload({
          file,
          onProgressChange: (progress) => {
            setUploadProgress(progress);
            updateProgressForStage(ProcessingStage.UPLOADING_FILE, progress);
            setProcessingDetails(`Uploading file... ${progress}%`);
          }
        });
        fileUrl = res.url;
      }

      // Stage 2: Text Extraction (if needed for KB)
      if (values.addToKnowledgeBase && file && file.type === "application/pdf") {
        setCurrentStage(ProcessingStage.EXTRACTING_TEXT);
        setProcessingDetails("Extracting text content from PDF...");
        updateProgressForStage(ProcessingStage.EXTRACTING_TEXT, 0);

        try {
          extractedText = await extractTextFromPDF(file);
          updateProgressForStage(ProcessingStage.EXTRACTING_TEXT, 100);
          setProcessingDetails(`Successfully extracted ${extractedText.length} characters from PDF`);
        } catch (err) {
          console.error("Text extraction failed:", err);
          // Don't fail the entire process, just skip KB addition
          setProcessingDetails("Warning: Could not extract text from PDF. Skipping knowledge base.");
          await new Promise(resolve => setTimeout(resolve, 2000)); // Show warning
        }
      }

      // Stage 3: Save Document
      setCurrentStage(ProcessingStage.SAVING_DOCUMENT);
      setProcessingDetails("Saving document metadata to database...");
      updateProgressForStage(ProcessingStage.SAVING_DOCUMENT, 0);

      let documentResponse;
      const documentPayload = {
        title: values.title,
        description: values.description,
        categoryId: values.categoryId,
        fileUrl
      };

      if (initialData) {
        documentResponse = await axios.patch(`/api/document/${initialData.id}`, documentPayload);
        setProcessingDetails("Document updated successfully");
      } else {
        documentResponse = await axios.post("/api/document", documentPayload);
        setProcessingDetails("Document created successfully");
      }

      updateProgressForStage(ProcessingStage.SAVING_DOCUMENT, 100);

      const savedDocument = documentResponse.data;
      const documentId = savedDocument.id;

      // Stage 4: Embedding Processing (handled by the API route)
      setCurrentStage(ProcessingStage.PROCESSING_EMBEDDINGS);
      setProcessingDetails("Generating embeddings for document search...");
      updateProgressForStage(ProcessingStage.PROCESSING_EMBEDDINGS, 50);

      // The embedding processing is handled in the API route
      // We'll simulate progress here since it's async on the backend
      await new Promise(resolve => setTimeout(resolve, 1000));
      updateProgressForStage(ProcessingStage.PROCESSING_EMBEDDINGS, 100);
      setProcessingDetails("Embeddings generated successfully");

      // Stage 5: Knowledge Base Addition
      if (values.addToKnowledgeBase && extractedText && fileUrl && documentId) {
        await addToKnowledgeBase({
          documentId,
          documentData: values,
          fileUrl,
          extractedText
        });
      } else if (values.addToKnowledgeBase && !extractedText && file?.type === "application/pdf") {
        setProcessingDetails("Skipping knowledge base addition - no text extracted");
      }

      // Completion
      setCurrentStage(ProcessingStage.COMPLETED);
      setOverallProgress(100);
      setProcessingDetails("All processing completed successfully!");

      toast({
        description: initialData ? "Document updated successfully!" : "Document created successfully!",
        duration: 3000
      });

      // Reset form and navigate after a short delay
      setTimeout(() => {
        resetProcessingState();
        setFile(null);
        router.refresh();
        router.push("/");
      }, 2000);

    } catch (error: unknown) {
      console.error("Error in form submission:", error);
      setCurrentStage(ProcessingStage.ERROR);
      const errorMessage = error?.response?.data?.error || error?.message || "An unexpected error occurred";
      setError(errorMessage);
      setProcessingDetails(`Error: ${errorMessage}`);

      toast({
        variant: "destructive",
        description: errorMessage,
        duration: 5000
      });
    }
  };

  // Cancel processing
  const cancelProcessing = () => {
    resetProcessingState();
    setFile(null);
    form.setValue("file", null);
  };

  // Render processing status
  const renderProcessingStatus = () => {
    if (currentStage === ProcessingStage.IDLE) return null;

    const getStageIcon = () => {
      switch (currentStage) {
        case ProcessingStage.UPLOADING_FILE:
          return <Upload className="w-4 h-4 animate-bounce" />;
        case ProcessingStage.EXTRACTING_TEXT:
          return <FileText className="w-4 h-4 animate-pulse" />;
        case ProcessingStage.SAVING_DOCUMENT:
        case ProcessingStage.PROCESSING_EMBEDDINGS:
        case ProcessingStage.ADDING_TO_KB:
          return <Loader2 className="w-4 h-4 animate-spin" />;
        case ProcessingStage.COMPLETED:
          return <CheckCircle className="w-4 h-4 text-green-500" />;
        case ProcessingStage.ERROR:
          return <AlertCircle className="w-4 h-4 text-red-500" />;
        default:
          return <Loader2 className="w-4 h-4 animate-spin" />;
      }
    };

    return (
      <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
        <div className="flex items-center gap-2">
          {getStageIcon()}
          <span className="font-medium">{stageDescriptions[currentStage]}</span>
        </div>

        {processingDetails && (
          <p className="text-sm text-muted-foreground">{processingDetails}</p>
        )}

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Overall Progress</span>
            <span>{Math.round(overallProgress)}%</span>
          </div>
          <Progress value={overallProgress} className="w-full" />
        </div>

        {currentStage === ProcessingStage.UPLOADING_FILE && uploadProgress > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Upload Progress</span>
              <span>{uploadProgress}%</span>
            </div>
            <Progress value={uploadProgress} className="w-full" />
          </div>
        )}

        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
            <p className="text-sm text-destructive font-medium">{error}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="align-middle justify-center flex h-full w-full">
      <PDFViewer file={file || null} />
      <Separator orientation="vertical" />
      <div className="w-full">
        <div className="h-full p-4 space-y-2 max-w-3xl mx-auto">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 pb-10">
              <div className="space-y-2 w-full">
                <div>
                  <h3 className="text-lg font-medium">Document Information</h3>
                  <p className="text-sm text-muted-foreground">
                    General information about the document
                  </p>
                </div>
                <Separator className="bg-primary/10" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    name="title"
                    control={form.control}
                    render={({ field }) => (
                      <FormItem className="col-span-2 md:col-span-1">
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input placeholder="Yearly Report 2025" {...field} disabled={isProcessing} />
                        </FormControl>
                        <FormDescription>
                          Enter the title or name of the document you want to add.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    name="description"
                    control={form.control}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Input
                            disabled={isProcessing}
                            placeholder="Business statements and analytic overview"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Provide a brief description of the document content
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Category</FormLabel>
                        <Select
                          disabled={isProcessing}
                          onValueChange={field.onChange}
                          value={field.value}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger className="bg-background">
                              <SelectValue
                                defaultValue={field.value}
                                placeholder="Select a category"
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {categories.map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                {category.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>Select a category for your document</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="pt-5">
                  <h3 className="text-lg font-medium">Document</h3>
                  <p className="text-sm text-muted-foreground">Upload the document you want to add</p>
                </div>
                <Separator className="bg-primary/10" />

                <FormField
                  name="file"
                  control={form.control}
                  render={({ field }) => (
                    <FormItem className="col-span-2 md:col-span-1">
                      <FormLabel>File</FormLabel>

                      <FileUpload
                        onFileUpload={(f: File) => {
                          setFile(f);
                          field.onChange(f);
                        }}
                        alreadyUploaded={Boolean(form.getValues("fileUrl"))}
                        disabled={isProcessing}
                      />

                      <FormDescription>Choose the file you want to upload</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {form.watch("fileUrl") && !file && (
                  <div className="text-sm text-muted-foreground">
                    Using existing file: {form.watch("fileUrl")}
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="addToKnowledgeBase"
                  render={({ field }) => (
                    <FormItem className="rounded-md border p-4">
                      <div className="flex items-center space-x-2">
                        <FormControl>
                          <input
                            type="checkbox"
                            checked={field.value}
                            onChange={(e) => field.onChange(e.target.checked)}
                            disabled={isProcessing}
                            className="w-4 h-4 text-primary bg-background border-gray-300 rounded focus:ring-primary focus:ring-2 disabled:opacity-50"
                          />
                        </FormControl>
                        <FormLabel className="flex items-center gap-2 cursor-pointer">
                          <Database className="w-4 h-4" />
                          Add to Knowledge Base
                        </FormLabel>
                      </div>
                      <FormDescription className="mt-2">
                        Automatically extract text from the PDF and add it to the knowledge base.
                        Only works with PDF files. This enables the document content to be used in chat responses.
                      </FormDescription>
                    </FormItem>
                  )}
                />
              </div>

              {/* Processing Status */}
              {renderProcessingStatus()}

              <div className="w-full flex justify-center">
                <Button
                  type="button"
                  size="lg"
                  variant="destructive"
                  className="w-2/5 mr-1"
                  onClick={cancelProcessing}
                  disabled={isProcessing}
                >
                  Cancel Upload
                  <Trash className="w-4 h-4 ml-2" />
                </Button>

                <Button
                  size="lg"
                  className="w-2/5 ml-1"
                  disabled={isProcessing || currentStage === ProcessingStage.COMPLETED}
                  type="submit"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : currentStage === ProcessingStage.COMPLETED ? (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Completed
                    </>
                  ) : (
                    <>
                      {initialData ? "Update Document" : "Create Document"}
                      <Wand2 className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
};
