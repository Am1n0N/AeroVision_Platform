// middleware.ts
import { authMiddleware } from "@clerk/nextjs";

export default authMiddleware({
  // Pages anyone can visit (no sign-in required)
  publicRoutes: [
    "/sign-in(.*)",          // sign-in page must be public
    "/sign-up(.*)",          // sign-up page must be public
    "/api/edgestore/init",   // make EdgeStore init public (remove if you want it protected)
    // static assets
    "/_next/static(.*)",
    "/_next/image(.*)",
    "/favicon.ico",
    "/(.*)\\.(png|jpg|jpeg|gif|svg|css|js|txt|webp|ico|map)"
  ],

  // Don’t run Clerk on static files at all
  ignoredRoutes: ["/((?!api|trpc))(_next.*|.+\\.[\\w]+$)"],

  // Treat all /api/** as API routes (application programming interface)
  apiRoutes: ["/api/(.*)"],

  // Turn this on only when debugging
  debug: true,
});

// Match app routes + API routes
export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
