import { auth } from "@clerk/nextjs/server";
import { UserRole } from "./roles";

export async function getCurrentUserRoles(): Promise<string[]> {
  const session = await auth();
  // Access roles array directly from metadata
  const roles = (session.sessionClaims?.metadata as any)?.roles || [];
  // Debug point for roles
  console.log('Current user roles:', roles);
  return roles;
}

export async function hasRole(role: UserRole): Promise<boolean> {
  const roles = await getCurrentUserRoles();
  const hasRole = roles.includes(role);
  // Debug point for role check
  console.log('Role check:', { role, roles, hasRole });
  return hasRole;
}

export async function isAdmin(): Promise<boolean> {
  const isAdminResult = await hasRole(UserRole.ADMIN);
  // Debug point for admin check
  console.log('Admin check result:', isAdminResult);
  return isAdminResult;
} 