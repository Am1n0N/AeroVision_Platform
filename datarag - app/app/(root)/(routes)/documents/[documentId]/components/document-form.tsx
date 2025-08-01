"use client";

import { Category, Document } from "@prisma/client";
import axios from "axios";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useRouter } from "next/navigation";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/components/ui/use-toast";
import { Separator } from "@/components/ui/separator";
import { useForm } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Cross, Trash, Wand2, Database } from "lucide-react";
import FileUpload from "@/components/file-upload";
import PDFViewer from "@/components/pdfviewer";
import { useState } from "react";
import { useEdgeStore } from "@/lib/edgestore";
import Link from "next/link";
import { loadFile } from "@/lib/pinecone";


interface DocumentIdPageProps {
    initialData: Document | null;
    categories: Category[];
};

const formSchema = z.object({
    title: z.string().min(1, { message: "Title is required" }),
    description: z.string().min(1, { message: "Description is required" }),
    categoryId: z.string().min(1, { message: "Category is required", }),
    fileurl: z.any().refine((value) => value instanceof File || value === null, {
        message: "File is required",
    }),
    addToKnowledgeBase: z.boolean().default(true),
});

// Helper function to extract text from PDF
const extractTextFromPDF = async (file: File): Promise<string> => {
    try {
        // Using PDF.js to extract text - you'll need to install pdfjs-dist
        const pdfjsLib = await import('pdfjs-dist');

        // Set up the worker
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        let fullText = '';

        // Extract text from each page
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map((item: any) => item.str)
                .join(' ');
            fullText += pageText + '\n';
        }

        return fullText.trim();
    } catch (error) {
        console.error('Error extracting text from PDF:', error);
        throw new Error('Failed to extract text from PDF');
    }
};

export const DocumentForm = ({
    initialData,
    categories,
}: DocumentIdPageProps) => {
    const router = useRouter();
    const { toast } = useToast();
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: initialData || {
            title: "",
            description: "",
            categoryId: undefined,
            fileurl: undefined,
            addToKnowledgeBase: true,
        }
    })

    const isLoading = form.formState.isSubmitting;
    const [file, setFile] = useState(null);
    const { edgestore } = useEdgeStore();
    const [progress, setProgress] = useState(0);
    const [kbProgress, setKbProgress] = useState(0);

    const [url, setUrl] = useState<string>(initialData?.fileurl || "");

    const addToKnowledgeBase = async (documentData: any, fileUrl: string, extractedText: string) => {
        try {
            setKbProgress(25);

            const selectedCategory = categories.find(cat => cat.id === documentData.categoryId);

            const knowledgeData = {
                content: extractedText,
                title: documentData.title,
                category: selectedCategory?.name || 'general',
                source: 'document_upload',
                tags: [
                    'document',
                    selectedCategory?.name || 'general',
                    'pdf'
                ]
            };

            setKbProgress(50);

            const response = await axios.post('/api/knowledge', knowledgeData);

            setKbProgress(100);

            if (response.status === 200) {
                toast({
                    description: "Document added to knowledge base successfully!",
                });
            }
        } catch (error) {
            console.error('Error adding to knowledge base:', error);
            toast({
                variant: "destructive",
                description: "Document saved but failed to add to knowledge base. You can try again later.",
            });
        } finally {
            setKbProgress(0);
        }
    };

    const onSubmit = async (values: z.infer<typeof formSchema>) => {
        try {
            let fileUrl = url;
            let extractedText = '';

            if (file) {
                // Upload file to EdgeStore
                const res = await edgestore.MyDocuments.upload({
                    file,
                    onProgressChange: (progress) => {
                        setProgress(progress);
                    }
                });
                setUrl(res.url);
                fileUrl = res.url;
                values.fileurl = res.url;

                // Extract text from PDF if addToKnowledgeBase is enabled
                if (values.addToKnowledgeBase && file.type === 'application/pdf') {
                    try {
                        toast({
                            description: "Extracting text from PDF...",
                        });
                        extractedText = await extractTextFromPDF(file);
                    } catch (error) {
                        console.error('Text extraction failed:', error);
                        toast({
                            variant: "destructive",
                            description: "Failed to extract text from PDF. Document will be saved without adding to knowledge base.",
                        });
                        values.addToKnowledgeBase = false;
                    }
                }
            }

            // Save document to database
            let documentResponse;
            if (initialData) {
                // Update the document
                documentResponse = await axios.patch(`/api/document/${initialData.id}`, {
                    title: values.title,
                    description: values.description,
                    categoryId: values.categoryId,
                    fileurl: values.fileurl
                });
            } else {
                // Create a new document
                documentResponse = await axios.post("/api/document", {
                    title: values.title,
                    description: values.description,
                    categoryId: values.categoryId,
                    fileurl: values.fileurl
                });
            }

            toast({
                description: "Document has been saved successfully.",
            });

            // Add to knowledge base if enabled and we have extracted text
            if (values.addToKnowledgeBase && extractedText && extractedText.length > 0) {
                await addToKnowledgeBase(values, fileUrl, extractedText);
            } else if (values.addToKnowledgeBase && (!extractedText || extractedText.length === 0)) {
                toast({
                    variant: "destructive",
                    description: "Document saved but no text could be extracted for knowledge base.",
                });
            }

            router.refresh();
            router.push('/');

        } catch (error) {
            console.error('Error in form submission:', error);
            toast({
                variant: "destructive",
                description: "Something went wrong. Please try again later.",
            });
        }
    };

    return (
        <div className="align-middle justify-center flex h-full w-full">
            <PDFViewer file={file} />
            <Separator orientation="vertical" />
            <div className="w-full">
                <div className="h-full p-4 space-y-2 max-w-3xl mx-auto">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 pb-10">
                            <div className="space-y-2 w-full">
                                <div>
                                    <h3 className="text-lg font-medium">
                                        Document Information
                                    </h3>
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
                                                    <Input placeholder="Yearly Report 2025" {...field} />
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
                                                    <Input disabled={isLoading} placeholder="Business statements and analytic overview" {...field} />
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
                                                <Select disabled={isLoading} onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="bg-background">
                                                            <SelectValue defaultValue={field.value} placeholder="Select a category" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {categories.map((category) => (
                                                            <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormDescription>
                                                    Select a category for your document
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <div className="pt-5">
                                    <h3 className="text-lg font-medium">
                                        Document
                                    </h3>
                                    <p className="text-sm text-muted-foreground">
                                        Upload the document you want to add
                                    </p>
                                </div>
                                <Separator className="bg-primary/10" />

                                <FormField
                                    name="fileurl"
                                    control={form.control}
                                    render={({ field }) => (
                                        <FormItem className="col-span-2 md:col-span-1">
                                            <FormLabel>File</FormLabel>
                                            {!file ?
                                            <FileUpload onFileUpload={
                                                (file: any) => {
                                                    setFile(file);
                                                    form.setValue("fileurl", file);
                                                }
                                            } alreadyUploaded={true}/>
                                           :
                                           <FileUpload onFileUpload={
                                                (file: any) => {
                                                    setFile(file);
                                                    form.setValue("fileurl", file);
                                                }
                                            } alreadyUploaded={false} />}

                                            <FormDescription>
                                                Choose the file you want to upload
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

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
                                                        disabled={isLoading}
                                                        className="w-4 h-4 text-primary bg-background border-gray-300 rounded focus:ring-primary focus:ring-2"
                                                    />
                                                </FormControl>
                                                <FormLabel className="flex items-center gap-2 cursor-pointer">
                                                    <Database className="w-4 h-4" />
                                                    Add to Knowledge Base
                                                </FormLabel>
                                            </div>
                                            <FormDescription className="mt-2">
                                                Automatically extract text from the PDF and add it to the knowledge base for AI-powered search and retrieval. Only works with PDF files.
                                            </FormDescription>
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <div className="w-full flex justify-center">
                                <Button size="lg" className="w-2/5 mr-1 bg-red-300" disabled={!file} onClick={() => {
                                    setFile(null)
                                    form.setValue("fileurl", undefined);
                                }}>
                                    Cancel Upload
                                    <Trash className="w-4 h-4 ml-2" />
                                </Button>
                                <Button size="lg" className="w-2/5 ml-1" disabled={isLoading}>
                                    {initialData ? "Edit your Document" : "Create your Document"}
                                    <Wand2 className="w-4 h-4 ml-2" />
                                </Button>
                            </div>
                        </form>

                        {/* Progress bars */}
                        <div className="space-y-2">
                            <div className="h-[6px] w-full border rounded overflow-hidden">
                                <div className="h-full bg-primary transition-all duration-150" style={{ width: `${progress}%` }} />
                            </div>
                            {kbProgress > 0 && (
                                <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground">Adding to knowledge base...</p>
                                    <div className="h-[6px] w-full border rounded overflow-hidden">
                                        <div className="h-full bg-green-500 transition-all duration-150" style={{ width: `${kbProgress}%` }} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </Form>
                </div>
            </div>
        </div>
    );
};
