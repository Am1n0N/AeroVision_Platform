import { Document } from "@prisma/client";
import Image from "next/image";
import Link from "next/link";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { Calendar, FileText } from "lucide-react";
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
      <div className="pt-16 flex flex-col items-center justify-center space-y-6 min-h-[60vh]">
        <div className="relative w-64 h-64 opacity-60">
          <Image
            fill
            className="grayscale-0 dark:grayscale"
            alt="No documents"
            src="/empty.png"
          />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            No documents yet
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md">
            Upload your first document to get started with AI-powered conversations
          </p>
        </div>
      </div>
    );
  }

  const gridView = (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6 pb-20">
      {data.map((document) => (
        <Link key={document.id} href={`/chat/${document.id}`}>
          <Card className="group h-full bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 transition-all duration-300 hover:shadow-xl hover:-tranzinc-y-1 cursor-pointer overflow-hidden">
            <CardHeader className="p-4 space-y-4">
              {/* Document Title */}
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <FileText className="w-4 h-4 text-zinc-500 dark:text-zinc-400 mt-1 flex-shrink-0" />
                  <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 line-clamp-2 leading-tight group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-colors">
                    {document.title}
                  </h3>
                </div>
                {document.description && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed text-wrap">
                    {document.description}
                  </p>
                )}
              </div>

              {/* PDF Thumbnail */}
              <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-800">
                <PdfThumbnail id={document.id} pdfUrl={document.fileUrl} />
              </div>
            </CardHeader>

            <CardFooter className="p-4 pt-0">
              <div className="flex items-center gap-2 w-full">
                <Calendar className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                <time className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {document.createdAt.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </time>
              </div>
            </CardFooter>
          </Card>
        </Link>
      ))}
    </div>
  );

  const columns = [
    {
      accessorKey: "fileUrl",
      header: "Preview",
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
      header: "Created",
    },
    {
      accessorKey: "updatedAt",
      header: "Updated",
    }
  ];

  const listView = (
    <div className="space-y-4 pb-20">
      <DocumentsTable data={data} columns={columns} />
    </div>
  );

  return (
    <div className="relative">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              Documents
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              {data.length} {data.length === 1 ? 'document' : 'documents'} available
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      {displayMode === "grid" ? gridView : listView}

      {/* Toggle Button */}
      <DocumentDisplayToggle />
    </div>
  );
};
