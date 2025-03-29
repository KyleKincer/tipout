"use client";

import { useUser } from "@clerk/nextjs";
import { UserRole } from "@/lib/roles";

interface RoleBasedUIProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
}

export function RoleBasedUI({ children, allowedRoles }: RoleBasedUIProps) {
  const { user } = useUser();
  const userRoles = (user?.publicMetadata?.roles as string[]) || [];

  const hasAllowedRole = allowedRoles.some(role => userRoles.includes(role));

  if (!hasAllowedRole) {
    return null;
  }

  return <>{children}</>;
}

export function AdminOnly({ children }: { children: React.ReactNode }) {
  return (
    <RoleBasedUI allowedRoles={[UserRole.ADMIN]}>
      {children}
    </RoleBasedUI>
  );
} 