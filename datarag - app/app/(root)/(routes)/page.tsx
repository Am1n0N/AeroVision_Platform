import { Categories } from "@/components/categories";
import { Documents } from "@/components/documents";
import { SearchInput } from "@/components/search-input";
import prismadb from "@/lib/prismadb";

interface RootPageProps {
  searchParams: {
    categoryId: string;
    name: string;
    displayMode: string;
  }
}

const RootPage = async ({
  searchParams
}: RootPageProps) => {

  const categories = await prismadb.category.findMany();

  const documents = await prismadb.document.findMany({
    where: {
      categoryId: searchParams.categoryId,
      title: {
        contains: searchParams.name
      }
    }
  });

  return (
    <div className="h-full p-4 space-y-2">
      <SearchInput />
      <Categories data={categories} />
      <Documents data={documents} displayMode={searchParams.displayMode} />
    </div>
  )
}

export default RootPage;
