import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { UserRole } from "@/lib/roles";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const roles = (session.sessionClaims?.metadata as any)?.roles as string[] | undefined;

  if (!roles?.includes(UserRole.ADMIN)) {
    redirect("/");
  }

  return (
    <div className="min-h-full">
      {children}
    </div>
  );
} 