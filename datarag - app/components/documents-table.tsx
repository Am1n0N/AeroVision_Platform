"use client";

import { ColumnDef, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { FileText, Calendar, Clock, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PdfThumbnail from "./pdf-thumbnail";

type DocRow = {
  id: string;
  title: string;
  description?: string | null;
  fileUrl?: string | null;
  numPages?: number | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

interface DocumentsTableProps<TData extends DocRow, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
}

function getCellValue(row: any, id: string) {
  return row.getVisibleCells().find((c: any) => c.column.id === id)?.getValue();
}

function fmtDate(v?: Date | string) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function DocumentsTable<TData extends DocRow, TValue>({
  columns,
  data,
}: DocumentsTableProps<TData, TValue>) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  const rows = table.getRowModel().rows ?? [];
  const router = useRouter();

  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/60 p-10 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
          <FileText className="h-8 w-8 text-zinc-400" />
        </div>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">No documents yet</h3>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Upload a PDF to see it here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {rows.map((row) => {
        const original = row.original as DocRow;
        const id = original.id;
        const title = (getCellValue(row, "title") as string) ?? original.title ?? "Untitled";
        const description = (getCellValue(row, "description") as string) ?? original.description ?? "";
        const fileUrl = (getCellValue(row, "fileUrl") as string) ?? original.fileUrl ?? "";
        const numPages = (getCellValue(row, "numPages") as number) ?? original.numPages ?? null;
        const createdAt = (getCellValue(row, "createdAt") as Date | string) ?? original.createdAt;
        const updatedAt = (getCellValue(row, "updatedAt") as Date | string) ?? original.updatedAt;

        return (
          <div
            key={row.id}
            role="button"
            tabIndex={0}
            onClick={() => router.push(`/chat/${id}`)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && router.push(`/chat/${id}`)}
            className="group relative w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-lg dark:border-zinc-700 dark:bg-zinc-900/70 dark:hover:border-zinc-600"
          >
            {/* NOTE: removed absolute full-card Link so controls can be clicked */}

            <div className="flex flex-col gap-6 p-6 md:flex-row md:items-start">
              {/* BIG preview */}
              <div className="relative mx-auto w-full max-w-[760px] md:mx-0 md:w-[420px] lg:w-[520px]">
                <div className="relative h-[560px] w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
                  <PdfThumbnail id={id} pdfUrl={fileUrl} />
                  <div className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-2 rounded-md bg-white/90 px-2.5 py-1 text-xs font-medium text-zinc-700 shadow-sm ring-1 ring-zinc-200 backdrop-blur dark:bg-zinc-900/70 dark:text-zinc-200 dark:ring-zinc-700">
                    {numPages ? `${numPages} pages` : "PDF"}
                  </div>
                </div>
              </div>

              {/* content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                        <FileText className="h-4.5 w-4.5 text-zinc-600 dark:text-zinc-400" />
                      </div>
                      <h3 className="truncate text-xl font-semibold text-zinc-900 transition-colors group-hover:text-zinc-700 dark:text-zinc-100 dark:group-hover:text-zinc-300">
                        {title}
                      </h3>
                    </div>
                  </div>

                  {/* dedicated open link that DOESN'T bubble */}
                  <Link
                    href={`/chat/${id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="z-20 inline-flex items-center rounded-lg border border-transparent p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    aria-label="Open"
                  >
                    <ExternalLink className="h-5 w-5" />
                  </Link>
                </div>

                <p className="mt-4 line-clamp-3 text-[15px] leading-7 text-zinc-600 dark:text-zinc-400">
                  {description || "No description available."}
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                    <Calendar className="h-4 w-4" />
                    <span className="font-medium">Created</span>
                    <time>{fmtDate(createdAt)}</time>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                    <Clock className="h-4 w-4" />
                    <span className="font-medium">Updated</span>
                    <time>{fmtDate(updatedAt)}</time>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
