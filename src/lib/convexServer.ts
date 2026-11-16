import { auth } from '@clerk/nextjs/server'
import { ConvexHttpClient } from 'convex/browser'
import { ConvexError } from 'convex/values'
import { NextResponse } from 'next/server'
import { errorResponse, HttpError } from './apiAuth'

/**
 * Which database the app reads and writes. Postgres until the Convex cutover sets DATA_BACKEND=convex;
 * setting it back (after copying any Convex-only changes back, see docs/CONVEX_CUTOVER_RUNBOOK.md) rolls back.
 */
export const usesConvex = () => process.env.DATA_BACKEND === 'convex'

/** A Convex client acting as the signed-in person, using their Clerk "convex" token. */
export async function convexForUser(): Promise<ConvexHttpClient> {
  const session = await auth()
  if (!session.userId) throw new HttpError(401, 'Sign in first.')
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) throw new HttpError(503, 'The database address (NEXT_PUBLIC_CONVEX_URL) is not set.')
  const token = await session.getToken({ template: 'convex' })
  if (!token) throw new HttpError(503, 'Sign-in to the database is not set up (Clerk has no "convex" token template).')
  const client = new ConvexHttpClient(url, { logger: false })
  client.setAuth(token)
  return client
}

/** Turn a Convex error carrying { status, message } into the same JSON error the Postgres routes return. */
export function convexErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ConvexError) {
    const data = error.data as { status?: number; message?: string } | string
    if (typeof data === 'object' && data?.status && data.message) return NextResponse.json({ error: data.message }, { status: data.status })
  }
  return errorResponse(error, fallback)
}

/** Run a Convex call for an API route and send its result as JSON. */
export async function viaConvex(fallback: string, call: (client: ConvexHttpClient) => Promise<unknown>) {
  try {
    return NextResponse.json(await call(await convexForUser()))
  } catch (error) {
    return convexErrorResponse(error, fallback)
  }
}
