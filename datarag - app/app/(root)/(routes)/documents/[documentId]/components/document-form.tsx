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
import { Cross, Trash, Wand2 } from "lucide-react";
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
});


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
            fileurl: undefined
        }
    })

    const isLoading = form.formState.isSubmitting;
    const [file, setFile] = useState(null);
    const { edgestore } = useEdgeStore();
    const [progress, setProgress] = useState(0);

    const [url, setUrl] = useState<string>(initialData?.fileurl || "");

    const onSubmit = async (values: z.infer<typeof formSchema>) => {
        try {
            if (file) {
                const res = await edgestore.MyDocuments.upload({
                    file,
                    onProgressChange: (progress) => {
                        setProgress(progress);
                    }
                });
                setUrl(res.url);

                values.fileurl = res.url;
            }

            if (initialData) {
                // Update the document
                await axios.patch(`/api/document/${initialData.id}`, values);
            } else {
                // Create a new document
                await axios.post("/api/document", values);
            }

            toast({
                description: "Document has been saved successfully.",
            });

            router.refresh();
            router.push('/');

        } catch (error) {
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
                                                    <Input disabled={isLoading} placeholder="
                                                    Business statements and analytic overview" {...field} />
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
                        <div className="h-[6px] w-full border rounded overflow-hidden">
                            <div className="h-full bg-primary transition-all duration-150" style={{ width: `${progress}%` }} />
                        </div>
                    </Form>
                </div>
            </div>
        </div>
    );
};
