"use client";
import { Check, Inbox } from "lucide-react";
import React from "react";
import { useDropzone } from "react-dropzone";

const FileUpload = ({ onFileUpload, alreadyUploaded, disabled = false }: { onFileUpload: (file: File) => void, alreadyUploaded: boolean, disabled?: boolean }) => {
  const { getRootProps, getInputProps } = useDropzone({
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    disabled,
    onDrop: (acceptedFiles: File[]) => {
      onFileUpload(acceptedFiles[0])
    },
  });
  return (
    <div className="p-2 bg-white rounded-xl">
      <div
        {...getRootProps({
          className:
            `border-dashed border-2 rounded-xl ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} bg-gray-50 py-8 flex justify-center items-center flex-col`,
        })}
      >
        <input {...getInputProps()} />
        {alreadyUploaded ?
          <>
            <Inbox className="w-10 h-10 text-black" />
            <p className="mt-2 text-sm text-slate-400">Drop your PDF Here</p>
          </>
          :
          <>
            <Check className="w-10 h-10 text-black" />
            <p className="mt-2 text-sm text-slate-400">File Uploaded</p>
          </>
        }
      </div>
    </div>
  );
};

export default FileUpload;
