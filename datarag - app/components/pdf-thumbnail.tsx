"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

type PdfThumbnailProps = {
  pdfUrl: string | null;
  initialPage?: number;
};

const PdfThumbnail = ({ pdfUrl, initialPage = 1 }: PdfThumbnailProps) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(initialPage);
  const [thumbnailWidth, setThumbnailWidth] = useState<number>(300);
  const containerRef = useRef<HTMLDivElement>(null);

  const clamp = (n: number, min: number, max: number) =>
    Math.min(Math.max(n, min), max);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    // Keep current page in bounds (or reset to 1 on first load)
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

  // Reset when URL changes / initialPage changes
  useEffect(() => {
    setPageNumber(initialPage);
    setNumPages(0);
  }, [pdfUrl, initialPage]);

  const goPrev = () => setPageNumber((p) => clamp((p ?? 1) - 1, 1, numPages || 1));
  const goNext = () => setPageNumber((p) => clamp((p ?? 1) + 1, 1, numPages || 1));

  const onPageInput: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const val = parseInt(e.target.value || "1", 10);
    if (Number.isFinite(val)) setPageNumber(clamp(val, 1, numPages || 1));
  };

  if (!pdfUrl) return <div className="text-sm text-muted-foreground">No PDF selected.</div>;

  return (
    <div ref={containerRef} className="w-full">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <button
          onClick={goPrev}
          disabled={pageNumber <= 1}
          className="rounded-md border px-2 py-1 disabled:opacity-50"
        >
          Prev
        </button>
        <button
          onClick={goNext}
          disabled={numPages ? pageNumber >= numPages : true}
          className="rounded-md border px-2 py-1 disabled:opacity-50"
        >
          Next
        </button>
        <span className="ml-2">
          Page{" "}
          <input
            type="number"
            min={1}
            max={numPages || 1}
            value={pageNumber}
            onChange={onPageInput}
            className="w-16 rounded-md border px-2 py-1"
          />{" "}
          {numPages ? `of ${numPages}` : ""}
        </span>
      </div>

      <Document
        file={pdfUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        loading={<div>Loading PDF…</div>}
        error={<div>An error occurred!</div>}
      >
        <Page
          pageNumber={pageNumber}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          width={thumbnailWidth}
        />
      </Document>
    </div>
  );
};

PdfThumbnail.displayName = "PdfThumbnail";
export default PdfThumbnail;
