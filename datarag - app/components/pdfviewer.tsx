"use client";
import Image from "next/image";
import { memo } from 'react';

type Props = {
  file?: File | null;
  remoteUrl?: string | null;
};

const PDFViewer = memo(({ file, remoteUrl }: Props) => {
  return (
    <div className="w-full">
      {remoteUrl ? (
        <iframe
          src={remoteUrl}
          className="w-full h-full"
        ></iframe>
      ) : (
        file ? (
          <iframe
            src={URL.createObjectURL(file)}
            className="w-full h-full"
          ></iframe>
        ) : (
          <div className="w-full h-full relative">
            <Image
              className="p-2 object-contain w-full h-full"
              width={100}
              height={100}
              src="/pdf-placeholder.jpg"
              alt="PDF viewer"
            />
            <div className="absolute inset-0 flex items-center justify-center text-black">
              <span>Upload a file to preview</span>
            </div>
          </div>
        )
      )}
    </div>
  );
});

PDFViewer.displayName = "PDFViewer";

export default PDFViewer;
