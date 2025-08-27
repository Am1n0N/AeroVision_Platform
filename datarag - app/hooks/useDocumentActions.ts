import { useState } from "react";
import { useRouter } from "next/navigation";

interface DocLike {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  fileUrl?: string | null;
}

async function apiUpdateDocumentMeta(
  id: string,
  patch: { title?: string; description?: string }
): Promise<Partial<DocLike>> {
  const res = await fetch(`/api/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiDeleteDocument(id: string): Promise<void> {
  const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export function useDocumentActions(
  initialDocument: DocLike,
  afterDeleteHref: string = "/"
) {
  const router = useRouter();
  const [docMeta, setDocMeta] = useState<DocLike>(initialDocument);
  const [busy, setBusy] = useState<null | "update" | "delete">(null);

  const updateDocument = async (patch: {
    title?: string;
    description?: string;
  }) => {
    setBusy("update");
    // Optimistic UI update
    setDocMeta((prev) => ({ ...prev, ...patch }));

    try {
      const updated = await apiUpdateDocumentMeta(initialDocument.id, patch);
      setDocMeta((prev) => ({ ...prev, ...updated }));
    } catch (error) {
      console.error("Update failed:", error);
      // Rollback optimistic update
      setDocMeta(initialDocument);
      throw error;
    } finally {
      setBusy(null);
    }
  };

  const deleteDocument = async () => {
    setBusy("delete");
    try {
      await apiDeleteDocument(initialDocument.id);
      router.push(afterDeleteHref);
    } catch (error) {
      console.error("Delete failed:", error);
      throw error;
    } finally {
      setBusy(null);
    }
  };

  return {
    docMeta,
    busy,
    updateDocument,
    deleteDocument,
  };
}
