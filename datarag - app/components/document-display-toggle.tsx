"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Eye, EyeOff, List, Box, ListIcon} from "lucide-react";
import queryString from "query-string";

export const DocumentDisplayToggle = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const displayMode = searchParams.get("displayMode") !== "grid";

  const toggleDisplay = () => {
    const query = { ...Object.fromEntries(searchParams), displayMode: displayMode ? "grid" : "list"};
    const url = queryString.stringifyUrl({ url: window.location.href, query }, { skipEmptyString: true, skipNull: true });
    router.push(url);
  };

  useEffect(() => {
    // Ensure the "displayMode" query parameter is always present
    if (searchParams.get("displayMode") === null) {
      const query = { ...Object.fromEntries(searchParams), displayMode: "list" };
      const url = queryString.stringifyUrl({ url: window.location.href, query }, { skipEmptyString: true, skipNull: true });
      router.push(url);
    }
  }, [searchParams, router]);

  return (
    <button
      className="fixed bottom-5 right-5 bg-primary-foreground text-primary p-3 rounded-full shadow-md hover:bg-primary/80 transition"
      onClick={toggleDisplay}
    >
      {displayMode ? <Box /> : <ListIcon />}
    </button>
  );
};