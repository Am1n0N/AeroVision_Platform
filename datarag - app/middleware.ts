// middleware.ts
import { authMiddleware } from "@clerk/nextjs";

export default authMiddleware({
  // Pages anyone can visit (no sign-in required)
  publicRoutes: [
    "/",                     // home (if you want it public)
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
  debug: false,
});

// Match app routes + API routes
export const config = {
  matcher: [
    "/((?!.+\\.[\\w]+$|_next).*)",
    "/(api|trpc)(.*)"
  ],
};
