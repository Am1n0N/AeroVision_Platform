import { Document } from "@prisma/client";
import Image from "next/image";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import PdfThumbnail from "./pdf-thumbnail";
import { DocumentDisplayToggle } from "./document-display-toggle";
import { DocumentsTable } from "./documents-table";

interface DocumentsProps {
  data: Document[];
  displayMode: string;
}

export const Documents = ({ data, displayMode }: DocumentsProps) => {
  if (!data || data.length === 0) {
    return (
      <div className="pt-10 flex flex-col items-center justify-center space-y-3">
        <div className="relative w-60 h-60">
          <Image fill className="grayscale" alt="Empty" src="/empty.png" />
        </div>
        <p className="text-sm text-muted-foreground">No Documents found</p>
      </div>
    );
  }

  const gridView = (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 pb-10 relative">
      {data.map((document) => (
        <Card
          key={document.id}
          className="bg-primary/10 rounded-xl   bottom-0"
        >
          <CardHeader className="flex flex-col justify-between text-center text-muted-foreground py-4">
            <p className="font-bold text-base pb-3 h-14 line-clamp-2">
              {document.title}
            </p>
            <div className="relative h-full w-full">
              <PdfThumbnail id={document.id} pdfUrl={document.fileUrl} />
            </div>
            <p className="text-xs line-clamp-2">{document.description}</p>
          </CardHeader>
          <CardFooter className="flex items-center justify-center text-xs text-muted-foreground">
            <p className="lowercase">
              {document.createdAt.toLocaleString()}
            </p>
          </CardFooter>
        </Card>
      ))}
    </div>
  );

  const columns = [
    {
      accessorKey: "fileUrl",
      header: "Thumbnail",
    },
    {
      accessorKey: "title",
      header: "Title",
    },
    {
      accessorKey: "description",
      header: "Description",
    },
    {
      accessorKey: "createdAt",
      header: "Date Created",
    },
    {
      accessorKey: "updatedAt",
      header: "Date Updated",
    }
  ];

  const listView = (
    <div className="space-y-2">
      <DocumentsTable data={data} columns={columns} />
    </div>
  );

  return (
    <div>
      {displayMode === "grid" ? gridView : listView}
      <DocumentDisplayToggle />
    </div>
  );
};
