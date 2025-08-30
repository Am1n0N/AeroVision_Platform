"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Poppins } from "next/font/google";
import { cn } from "@/lib/utils";

import { ModeToggle } from "@/components/mode-toggle";
import { MobileSidebar } from "@/components/mobile-sidebar";
import { Button } from "@/components/ui/button";

import {
  UserButton,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
} from "@clerk/nextjs";

import { Plane } from "lucide-react";

const font = Poppins({
  weight: "600",
  subsets: ["latin"],
});

const NAV_LINKS = [
  { href: "/chat", label: "Chat" },
  { href: "/database", label: "Data" },
  { href: "/evaluate", label: "Evaluate" },
];

export const Navbar = () => {
  const pathname = usePathname();

  return (
    <header className="fixed inset-x-0 top-0 z-50 ">
      {/* subtle top accent */}
      <div className="h-0.5 w-full bg-gradient-to-r from-primary/70 via-primary/30 to-primary/70" />

      <div
        className={cn(
          "mx-auto  px-4 md:px-6",
          "backdrop-blur-lg supports-[backdrop-filter]:bg-background/60",
          "border-b border-border/60"
        )}
      >
        <div className="flex h-16 items-center justify-between gap-3">
          {/* Left: mobile menu + logo */}
          <div className="flex items-center gap-2">
            <MobileSidebar />
            <Link
              href="/"
              className="group inline-flex items-center gap-2 rounded-xl px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <span className="rounded-xl p-1.5 ring-1 ring-border/60 transition group-hover:scale-105 group-hover:ring-primary/40">
                <Plane className="h-5 w-5" />
              </span>
              <span
                className={cn(
                  "hidden md:inline-block text-xl md:text-2xl font-bold",
                  "bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent",
                  font.className
                )}
              >
                AeroVision
              </span>
            </Link>
          </div>

          

          {/* Right: actions */}
          <div className="flex items-center gap-2">
            <ModeToggle />

            <SignedIn>
              {/* Optional primary CTA */}
              <Link href="/chat">
                <Button size="sm" className="rounded-xl">
                  New Chat
                </Button>
              </Link>
              <UserButton
                afterSignOutUrl="/"
                appearance={{
                  elements: {
                    avatarBox: "ring-1 ring-border/60 rounded-full",
                  },
                }}
              />
            </SignedIn>

            <SignedOut>
              <SignInButton mode="modal">
                <Button variant="ghost" size="sm" className="rounded-xl">
                  Sign in
                </Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button size="sm" className="rounded-xl">
                  Get started
                </Button>
              </SignUpButton>
            </SignedOut>
          </div>
        </div>
      </div>
    </header>
  );
};
