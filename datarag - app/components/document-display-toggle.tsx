"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Grid3x3, List, Sparkles } from "lucide-react";
import queryString from "query-string";

export const DocumentDisplayToggle = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const displayMode = searchParams.get("displayMode") !== "grid";
  const [isAnimating, setIsAnimating] = useState(false);

  const toggleDisplay = () => {
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 300);

    const query = {
      ...Object.fromEntries(searchParams),
      displayMode: displayMode ? "grid" : "list"
    };
    const url = queryString.stringifyUrl(
      { url: window.location.href, query },
      { skipEmptyString: true, skipNull: true }
    );
    router.push(url);
  };

  useEffect(() => {
    // Ensure the "displayMode" query parameter is always present
    if (searchParams.get("displayMode") === null) {
      const query = {
        ...Object.fromEntries(searchParams),
        displayMode: "list"
      };
      const url = queryString.stringifyUrl(
        { url: window.location.href, query },
        { skipEmptyString: true, skipNull: true }
      );
      router.push(url);
    }
  }, [searchParams, router]);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div className="relative group">
        {/* Glow Effect */}
        <div className="absolute -inset-1 bg-gradient-to-r from-zinc-400 to-zinc-600 dark:from-zinc-600 dark:to-zinc-800 rounded-full blur opacity-25 group-hover:opacity-40 transition-opacity duration-300"></div>

        {/* Main Button */}
        <button
          className="relative flex items-center justify-center w-14 h-14 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 rounded-full shadow-xl hover:shadow-2xl border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 transition-all duration-300 hover:scale-105 active:scale-95"
          onClick={toggleDisplay}
        >
          {/* Icon with rotation animation */}
          <div className={`transition-transform duration-300 ${isAnimating ? 'rotate-180' : ''}`}>
            {displayMode ? (
              <Grid3x3 className="w-5 h-5" />
            ) : (
              <List className="w-5 h-5" />
            )}
          </div>

          {/* Sparkle animation on hover */}
          <div className="absolute -inset-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <Sparkles className="absolute top-0 right-0 w-3 h-3 text-zinc-400 dark:text-zinc-500 animate-pulse" />
            <Sparkles className="absolute bottom-0 left-0 w-2 h-2 text-zinc-500 dark:text-zinc-600 animate-pulse delay-75" />
          </div>
        </button>

        {/* Tooltip */}
        <div className="absolute bottom-full right-0 mb-3 px-3 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none whitespace-nowrap">
          Switch to {displayMode ? "Grid" : "List"} View
          <div className="absolute top-full right-4 w-2 h-2 bg-zinc-900 dark:bg-zinc-100 rotate-45 transform -tranzinc-y-1"></div>
        </div>
      </div>
    </div>
  );
};
