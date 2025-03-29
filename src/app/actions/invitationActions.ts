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

/**
 * Gets a list of invitations from Clerk
 */
export async function getInvitations(status?: 'pending' | 'accepted' | 'revoked') {
  if (!(await isAdmin())) {
    console.error("Unauthorized: Admin role required.");
    throw new Error("Unauthorized");
  }

  try {
    const clerk = await clerkClient();
    const params = status ? { status } : {};
    const invitations = await clerk.invitations.getInvitationList(params);
    return invitations;
  } catch (error) {
    console.error("Error fetching invitations:", error);
    throw new Error("Failed to fetch invitations");
  }
}

/**
 * Creates a new invitation
 */
export async function createInvitation(formData: FormData): Promise<void> {
  if (!(await isAdmin())) {
    console.error("Unauthorized: Admin role required.");
    throw new Error("Unauthorized");
  }

  const emailAddress = formData.get("emailAddress") as string;
  
  if (!emailAddress) {
    console.error("Email address is required");
    throw new Error("Email address is required");
  }

  try {
    const clerk = await clerkClient();
    
    await clerk.invitations.createInvitation({
      emailAddress,
      publicMetadata: {
        roles: [UserRole.USER], // Default role for new users
      },
      // By default, Clerk will handle the invitation flow
      notify: true,
    });

    revalidatePath("/admin");
  } catch (error) {
    console.error("Error creating invitation:", error);
    throw new Error(`Failed to create invitation: ${(error as Error).message}`);
  }
}

/**
 * Revokes an invitation
 */
export async function revokeInvitation(formData: FormData): Promise<void> {
  if (!(await isAdmin())) {
    console.error("Unauthorized: Admin role required.");
    throw new Error("Unauthorized");
  }

  const invitationId = formData.get("invitationId") as string;
  
  if (!invitationId) {
    console.error("Invitation ID is required");
    throw new Error("Invitation ID is required");
  }

  try {
    const clerk = await clerkClient();
    await clerk.invitations.revokeInvitation(invitationId);
    revalidatePath("/admin");
  } catch (error) {
    console.error("Error revoking invitation:", error);
    throw new Error("Failed to revoke invitation");
  }
} 