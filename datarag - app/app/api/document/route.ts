import { loadFile } from "@/lib/pinecone";
import prismadb from "@/lib/prismadb";
import { currentUser } from "@clerk/nextjs"
import { NextResponse } from "next/server"

export async function POST(req: Request){
    try{
        const body = await req.json()
        const user = await currentUser()

        const { title, description, fileurl, categoryId } = body

        if(!user || !user.id || !user.firstName){
            return new NextResponse(
                "Unauthorized",
                {status: 401}
            )
        }

        if (!title || !description || !fileurl || !categoryId){
            return new NextResponse(
                "Missing required fields",
                {status: 400}
            )
        }

        const document = await prismadb.document.create({
            data: {
                title,
                description,
                categoryId,
                fileurl,
                createdBy: user.id
            }
        });

        const embedFile = await loadFile(fileurl, document.id)
        console.log("Embed file", embedFile)

        return NextResponse.json(document);


    }catch(error){
        console.log(
            "[Document.POST]",error
        )
        return new NextResponse(
            "Internal Server Error",
            {status: 500}
        )
    }
}