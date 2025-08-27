import prismadb from "@/lib/prismadb";
import { auth, currentUser } from "@clerk/nextjs"
import { NextResponse } from "next/server"

export async function PATCH(req: Request ,
    { params }: {params: {documentId: string}}
    ){
    try{
        const body = await req.json()
        const user = await currentUser()

        const { title, description, fileUrl, categoryId } = body

        if(!params.documentId){
            return new NextResponse(
                "Document ID is required",
                {status: 400}
            )
        }

        if(!user || !user.id || !user.firstName){
            return new NextResponse(
                "Unauthorized",
                {status: 401}
            )
        }

        if (!title || !description || !fileUrl || !categoryId){
            return new NextResponse(
                "Missing required fields",
                {status: 400}
            )
        }
        const document = await prismadb.document.update({
            data: {
                title,
                description,
                categoryId,
                fileUrl,
                userId: user.id
            },
            where: {
                id: params.documentId,
                userId: user.id
            }
        });
        return NextResponse.json(document);


    }catch(error){
        console.log(
            "[Document.PATCH]",error
        )
        return new NextResponse(
            "Internal Server Error",
            {status: 500}
        )
    }
}

export async function DELETE(
    request: Request,
    { params }: {params: {documentId: string}}
    ){
    try{
        const {userId} = auth();

        if (!userId){
            return new NextResponse(
                "Unauthorized",
                {status: 401}
            )
        }

        if(!params.documentId){
            return new NextResponse(
                "Document ID is required",
                {status: 400}
            )
        }

        const document = await prismadb.document.delete({
            where: {
            id: params.documentId,
            userId: userId}
        });

        return NextResponse.json(document);

    }catch(error){
        console.log(
            "[Document.DELETE]",error
        )
        return new NextResponse(
            "Internal Server Error",
            {status: 500}
        )
    }
}
