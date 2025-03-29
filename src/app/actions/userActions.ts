"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { UserRole } from "@/lib/roles";

// Helper function to check if the current user is an admin
async function isAdmin(): Promise<boolean> {
  const session = await auth();
  const roles = (session.sessionClaims?.metadata as any)?.roles as string[] | undefined;
  return roles?.includes(UserRole.ADMIN) ?? false;
}

export async function assignRole(formData: FormData): Promise<void> {
  const userId = formData.get("userId") as string;
  const role = formData.get("role") as UserRole;

  if (!userId || !role || !Object.values(UserRole).includes(role)) {
    console.error("Invalid user ID or role.");
    return;
  }

  // --- Security Check: Ensure the calling user is an admin ---
  if (!(await isAdmin())) {
    console.error("Unauthorized: Admin role required.");
    return;
  }
  // --- End Security Check ---

  try {
    // Optional: Fetch current roles to append/update correctly
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    const currentRoles = (user.publicMetadata?.roles as string[]) || [];

    // Avoid duplicate roles
    const newRoles = [...new Set([...currentRoles, role])];

    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: {
        ...user.publicMetadata, // Preserve other metadata
        roles: newRoles,
      },
    });

    // Revalidate paths where user data might be displayed
    revalidatePath("/admin");

  } catch (error) {
    console.error("Error assigning role:", error);
  }
}

export async function removeRole(formData: FormData): Promise<void> {
  const userId = formData.get("userId") as string;
  const role = formData.get("role") as UserRole;

  if (!userId || !role) {
    console.error("Invalid user ID or role.");
    return;
  }
  
  if (!(await isAdmin())) {
    console.error("Unauthorized.");
    return;
  }

  try {
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    const currentRoles = (user.publicMetadata?.roles as string[]) || [];
    const newRoles = currentRoles.filter(r => r !== role);

    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: {
        ...user.publicMetadata,
        roles: newRoles,
      },
    });
    
    // Revalidate the admin page
    revalidatePath("/admin");
    
  } catch (error) {
    console.error("Error removing role:", error);
  }
} 