import { auth, currentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

export type Actor = { id: string; name: string; isAdmin: boolean }

/** An error with an HTTP status and a message that is safe to show to the person. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function errorResponse(error: unknown, fallback: string) {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error(fallback, error)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

/** The signed-in person, or a 401. Admin comes from Clerk public metadata, as everywhere else. */
export async function requireUser(): Promise<Actor> {
  const session = await auth()
  if (!session.userId) throw new HttpError(401, 'Sign in first.')
  const roles = ((session.sessionClaims?.metadata as { roles?: string[] } | undefined)?.roles) ?? []
  return { id: session.userId, name: session.userId, isAdmin: roles.includes('admin') }
}

/** The signed-in admin, with a display name for the change log, or a 401/403. */
export async function requireAdmin(): Promise<Actor> {
  const actor = await requireUser()
  if (!actor.isAdmin) throw new HttpError(403, 'Only admins can do that.')
  return { ...actor, name: await displayName(actor.id) }
}

/** A signed-in person with a display name, for changes anyone signed in may make. */
export async function requireNamedUser(): Promise<Actor> {
  const actor = await requireUser()
  return { ...actor, name: await displayName(actor.id) }
}

async function displayName(fallback: string) {
  try {
    const user = await currentUser()
    return user?.fullName || user?.primaryEmailAddress?.emailAddress || user?.username || fallback
  } catch {
    return fallback
  }
}
