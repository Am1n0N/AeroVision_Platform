import { ModernEmbeddingIntegration } from "@/lib/agent";
import prismadb from "@/lib/prismadb";
import { currentUser } from "@clerk/nextjs";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const user = await currentUser();

        const { title, description, fileUrl, categoryId } = body;

        if (!user || !user.id || !user.firstName) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        if (!title || !description || !fileUrl || !categoryId) {
            return new NextResponse("Missing required fields", { status: 400 });
        }

        // Verify category exists
        const category = await prismadb.category.findUnique({
            where: { id: categoryId }
        });

        if (!category) {
            return new NextResponse("Invalid category", { status: 400 });
        }

        // Create document with initial status
        const document = await prismadb.document.create({
            data: {
                title,
                description,
                categoryId,
                fileUrl,
                userId: user.id,
                status: "PROCESSING" // Set initial status
            }
        });

        // Start embedding processing asynchronously
        try {
            const integration = new ModernEmbeddingIntegration();
            const embedResult = await integration.processFile(fileUrl, document.id);
            console.log("Embed file result:", embedResult);

            // Update document status to COMPLETED
            await prismadb.document.update({
                where: { id: document.id },
                data: {
                    status: "COMPLETED"
                }
            });

        } catch (embedError) {
            console.error("Embedding processing failed:", embedError);

            // Update document status to ERROR but don't fail the request
            await prismadb.document.update({
                where: { id: document.id },
                data: {
                    status: "ERROR"
                }
            }).catch(console.error);

            // Log the error but continue - document is still created
            console.warn(`Document ${document.id} created but embedding failed:`, embedError);
        }

        return NextResponse.json(document);

    } catch (error) {
        console.error("[Document.POST]", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}

export async function PATCH(
    req: Request,
    { params }: { params: { documentId: string } }
) {
    try {
        const body = await req.json();
        const user = await currentUser();

        const { title, description, fileUrl, categoryId } = body;

        if (!user || !user.id) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        if (!params.documentId) {
            return new NextResponse("Document ID required", { status: 400 });
        }

        // Verify document exists and belongs to user
        const existingDocument = await prismadb.document.findFirst({
            where: {
                id: params.documentId,
                userId: user.id
            }
        });

        if (!existingDocument) {
            return new NextResponse("Document not found", { status: 404 });
        }

        // Verify category if provided
        if (categoryId) {
            const category = await prismadb.category.findUnique({
                where: { id: categoryId }
            });

            if (!category) {
                return new NextResponse("Invalid category", { status: 400 });
            }
        }

        // Update document
        const updatedDocument = await prismadb.document.update({
            where: { id: params.documentId },
            data: {
                ...(title && { title }),
                ...(description && { description }),
                ...(categoryId && { categoryId }),
                ...(fileUrl && { fileUrl, status: "PROCESSING" }), // Reset status if new file
            }
        });

        // If file URL changed, reprocess embeddings
        if (fileUrl && fileUrl !== existingDocument.fileUrl) {
            try {
                const integration = new ModernEmbeddingIntegration();
                await integration.processFile(fileUrl, updatedDocument.id);

                // Update status to completed
                await prismadb.document.update({
                    where: { id: updatedDocument.id },
                    data: { status: "COMPLETED" }
                });

            } catch (embedError) {
                console.error("Embedding reprocessing failed:", embedError);

                await prismadb.document.update({
                    where: { id: updatedDocument.id },
                    data: { status: "ERROR" }
                }).catch(console.error);
            }
        }

        return NextResponse.json(updatedDocument);

    } catch (error) {
        console.error("[Document.PATCH]", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}

export async function DELETE(
    req: Request,
    { params }: { params: { documentId: string } }
) {
    try {
        const user = await currentUser();

        if (!user || !user.id) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        if (!params.documentId) {
            return new NextResponse("Document ID required", { status: 400 });
        }

        // Verify document exists and belongs to user
        const existingDocument = await prismadb.document.findFirst({
            where: {
                id: params.documentId,
                userId: user.id
            }
        });

        if (!existingDocument) {
            return new NextResponse("Document not found", { status: 404 });
        }

        // Delete document and related data (CASCADE handles chunks and messages)
        await prismadb.document.delete({
            where: { id: params.documentId }
        });

        // Also clean up knowledge base entries related to this document
        try {
            await prismadb.knowledgeBaseEntry.deleteMany({
                where: {
                    metadata: {
                        contains: `"documentId":"${params.documentId}"`
                    }
                }
            });
        } catch (kbError) {
            console.warn("Failed to clean up knowledge base entries:", kbError);
        }

        return new NextResponse(null, { status: 204 });

    } catch (error) {
        console.error("[Document.DELETE]", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
