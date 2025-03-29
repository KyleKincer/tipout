import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { UserRole } from "@/lib/roles";
import Link from "next/link";

// Admin navigation component with link back to main app
function AdminNavigation() {
  return (
    <div className="bg-white dark:bg-gray-900 shadow">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 justify-between items-center">
          <div className="flex items-center">
            <Link href="/admin" className="text-xl font-bold text-gray-900 dark:text-white">
              admin
            </Link>
          </div>
          <Link
            href="/"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            back
          </Link>
        </div>
      </div>
    </div>
  );
}

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
      <AdminNavigation />
      <div className="py-2">
        {children}
      </div>
    </div>
  );
} 