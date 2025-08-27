import prismadb from "@/lib/prismadb";
import { DocumentForm } from "./components/document-form";
import { auth, redirectToSignIn } from "@clerk/nextjs";


interface DocumentIdPageProps {
    params: {
        documentId: string;
    };
};

const DocumentIdPage = async ({params}:DocumentIdPageProps) => {

    const {userId} = auth();

    if (!userId){
        return redirectToSignIn();
    }

    const document = await prismadb.document.findUnique({
        where: {
            id: params.documentId,
            userId: userId
        }
    });

    const categories = await prismadb.category.findMany();


    return (
        <DocumentForm initialData={document} categories={categories}/>
    );
}

export default DocumentIdPage;
