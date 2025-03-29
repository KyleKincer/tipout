export enum UserRole {
  ADMIN = "admin",
  USER = "user"
}

export type UserRoles = UserRole[];

export function hasRole(userRoles: UserRoles | undefined, role: UserRole): boolean {
  if (!userRoles) return false;
  return userRoles.includes(role);
}

export function isAdmin(userRoles: UserRoles | undefined): boolean {
  return hasRole(userRoles, UserRole.ADMIN);
} 