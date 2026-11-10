import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isAdminRoute = createRouteMatcher(['/admin(.*)', '/changes(.*)'])
const isApiRoute = createRouteMatcher(['/api/(.*)'])
// Define public routes that don't require authentication. API routes are not public: every one
// needs a signed-in user, and the routes themselves check for admin where it matters.
const isPublicRoute = createRouteMatcher([
  '/', // Landing page
  '/sign-in(.*)', // Sign-in pages
  '/verification(.*)', // For email verification links
  // Special invitation paths for Clerk - these will contain tokens for valid invitations only
  '/sign-up/invitation/(.*)', // For Clerk invitation links
])

export default clerkMiddleware(async (auth, req) => {
  const session = await auth();
  const isAuthenticated = !!session.userId;
  const metadata = session.sessionClaims?.metadata as { roles?: string[] } | undefined;

  if (!isAuthenticated && isApiRoute(req)) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  }

  // Redirect unauthenticated users to sign-in except for public routes
  if (!isAuthenticated && !isPublicRoute(req)) {
    const signInUrl = new URL('/sign-in', req.url);
    // Add the original URL as a redirect parameter
    signInUrl.searchParams.set('redirect_url', req.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }
  
  // Admin route protection (for authenticated users)
  if (isAuthenticated && isAdminRoute(req) && !metadata?.roles?.includes('admin')) {
    const url = new URL('/', req.url)
    return NextResponse.redirect(url)
  }

  // Protect edit/delete operations (for authenticated users)
  const isProtectedOperation = createRouteMatcher([
    '/shifts/:id/edit',
    '/shifts/:id/delete',
    '/employees/:id/edit',
    '/employees/:id/delete',
    '/roles/:id/edit',
    '/roles/:id/delete',
    '/admin/(.*)',
  ])

  if (isAuthenticated && isProtectedOperation(req) && !metadata?.roles?.includes('admin')) {
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