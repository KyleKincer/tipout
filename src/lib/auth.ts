import { auth } from "@clerk/nextjs/server";
import { UserRole } from "./roles";

// Clerk's custom session claims and public metadata are unknown until checked.
// Malformed metadata must not grant access or make an authorization check throw.
export function getRolesFromMetadata(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || !("roles" in metadata)) {
    return [];
  }

  const roles = metadata.roles;
  return Array.isArray(roles) && roles.every((role: unknown): role is string => typeof role === "string")
    ? roles
    : [];
}

export async function getCurrentUserRoles(): Promise<string[]> {
  const session = await auth();
  return getRolesFromMetadata(session.sessionClaims?.metadata);
}

export async function hasRole(role: UserRole): Promise<boolean> {
  const roles = await getCurrentUserRoles();
  return roles.includes(role);
}

export async function isAdmin(): Promise<boolean> {
  return hasRole(UserRole.ADMIN);
}
