"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

type PdfThumbnailProps = {
  id: string;
  pdfUrl: string | null;
  initialPage?: number;
};

const PdfThumbnail = ({ id, pdfUrl, initialPage = 1 }: PdfThumbnailProps) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(initialPage);
  const [thumbnailWidth, setThumbnailWidth] = useState<number>(300);
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber((prev) => clamp(prev || 1, 1, numPages));
  };

  const handleResize = useCallback(() => {
    const w = containerRef.current?.offsetWidth ?? 0;
    setThumbnailWidth(w > 0 ? w : 300);
  }, []);

  useEffect(() => {
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  useEffect(() => {
    setPageNumber(initialPage);
    setNumPages(0);
  }, [pdfUrl, initialPage]);

  const goPrev = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPageNumber((p) => clamp((p ?? 1) - 1, 1, numPages || 1));
  };

  const goNext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPageNumber((p) => clamp((p ?? 1) + 1, 1, numPages || 1));
  };

  const onPageInput: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    e.stopPropagation();
    const val = parseInt(e.target.value || "1", 10);
    if (Number.isFinite(val)) setPageNumber(clamp(val, 1, numPages || 1));
  };

  if (!pdfUrl) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 dark:border-slate-600">
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-200 dark:bg-slate-700">
            <svg className="h-6 w-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">No PDF available</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="group h-full w-full"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Fill parent height */}
      <div className="relative h-full overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/5 transition-all duration-300 hover:shadow-xl hover:ring-black/10 dark:bg-slate-900 dark:ring-white/10 dark:hover:ring-white/20">
        {/* PDF Document */}
        <div className="absolute inset-0">
          <Document
            file={pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <div className="flex h-full min-h-[320px] items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900">
                <div className="flex flex-col items-center space-y-2">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
                  <p className="text-sm text-slate-600 dark:text-slate-400">Loading PDF...</p>
                </div>
              </div>
            }
            error={
              <div className="flex h-full min-h-[320px] items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 text-slate-600 dark:from-slate-800 dark:to-slate-900 dark:text-slate-400">
                <div className="text-center">
                  <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700">
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <p className="text-sm">Failed to load PDF</p>
                </div>
              </div>
            }
          >
            <Page
              pageNumber={pageNumber}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              width={thumbnailWidth}
              className="mx-auto transition-transform duration-300"
            />
          </Document>

          {/* Open in Chat Overlay */}
          <Link href={`/chat/${id}`}>
            <div
              className={`absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
                isHovered ? "opacity-100" : "opacity-0"
              }`}
            >
              <div className="rounded-full bg-white p-3 shadow-xl transition-transform duration-300 hover:scale-110 dark:bg-slate-800">
                <ExternalLink className="h-6 w-6 text-slate-700 dark:text-slate-300" />
              </div>
            </div>
          </Link>
        </div>

        {/* Controls */}
        {numPages > 1 && (
          <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2">
            <div className="pointer-events-auto rounded-full bg-white/90 px-3 py-2 backdrop-blur-sm shadow-lg ring-1 ring-black/5 dark:bg-slate-800/90 dark:ring-white/10">
              <div className="flex items-center gap-2">
                <button
                  onClick={goPrev}
                  disabled={pageNumber <= 1}
                  className="rounded-full p-1.5 transition-colors duration-200 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-slate-700"
                >
                  <ChevronLeft className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                </button>

                <div className="flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                  <input
                    type="number"
                    min={1}
                    max={numPages || 1}
                    value={pageNumber}
                    onChange={onPageInput}
                    onClick={(e) => e.stopPropagation()}
                    className="w-10 rounded bg-transparent px-1 text-center outline-none focus:bg-white dark:focus:bg-slate-700"
                  />
                  <span>/</span>
                  <span>{numPages}</span>
                </div>

                <button
                  onClick={goNext}
                  disabled={numPages ? pageNumber >= numPages : true}
                  className="rounded-full p-1.5 transition-colors duration-200 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-slate-700"
                >
                  <ChevronRight className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

PdfThumbnail.displayName = "PdfThumbnail";
export default PdfThumbnail;
