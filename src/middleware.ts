import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from "next/server";
import { UserRole } from "./lib/roles";

const isAdminRoute = createRouteMatcher(['/admin(.*)'])

export default clerkMiddleware(async (auth, req) => {
  // Protect all routes starting with `/admin`
  const session = await auth();
  const metadata = session.sessionClaims?.metadata as { roles?: string[] } | undefined;
  
  // Good place for a breakpoint - log session data
  console.log('Session metadata:', {
    sessionClaims: session.sessionClaims,
    metadata: metadata,
    url: req.url
  });
  
  if (isAdminRoute(req) && !metadata?.roles?.includes('admin')) {
    const url = new URL('/', req.url)
    return NextResponse.redirect(url)
  }

  // Protect edit/delete operations
  const isProtectedOperation = createRouteMatcher([
    '/shifts/:id/edit',
    '/shifts/:id/delete',
    '/employees/:id/edit',
    '/employees/:id/delete',
    '/roles/:id/edit',
    '/roles/:id/delete'
  ])

  if (isProtectedOperation(req) && !metadata?.roles?.includes('admin')) {
    const url = new URL('/', req.url)
    return NextResponse.redirect(url)
  }
})

// Protect all routes including api/trpc routes
// Please edit this to allow other routes to be public as needed.
export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};