"use client"

import { useEffect, useState } from "react";
import { Document, Page, pdfjs } from 'react-pdf';

const PdfThumbnail = ({ pdfUrl }: { pdfUrl: string | null }) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [thumbnailWidth, setThumbnailWidth] = useState(300);

  pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const handleResize = () => {
    const containerWidth = (document.querySelector('.relative.h-full.w-full') as HTMLElement)?.offsetWidth || 0;
    const containerHeight = (document.querySelector('.relative.h-full.w-full') as HTMLElement)?.offsetHeight || 0;
    setThumbnailWidth(containerWidth);
  };

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const onLoadError = (error: any) => {
    console.log("Error loading PDF:", error);
  };

  return (
    <div>
      <Document file={pdfUrl} onLoadSuccess={onDocumentLoadSuccess} error={<div>An error occurred!</div>}>
        <Page pageNumber={pageNumber} renderTextLayer={false} renderAnnotationLayer={false} width={thumbnailWidth} />
      </Document>
    </div>
  );
};

PdfThumbnail.displayName = "PdfThumbnail";

export default PdfThumbnail;
