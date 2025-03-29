import { redirect } from 'next/navigation'
import { SearchUsers } from './SearchUsers'
import { clerkClient, auth } from '@clerk/nextjs/server'
import { assignRole, removeRole } from '@/app/actions/userActions'
import { UserRole, isAdmin } from '@/lib/roles'
import { Suspense } from 'react'
import ManageInvitations from './ManageInvitations'
import { UserItem } from './components/UserItem'

// Type for serialized user data
type SerializedUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  emailAddress: string | null;
  roles: string[];
};

// Helper function to generate initials from first and last name
function getInitials(firstName: string | null, lastName: string | null): string {
  const first = firstName?.charAt(0) || '';
  const last = lastName?.charAt(0) || '';
  return (first + last).toUpperCase();
}

// Helper function to generate a consistent color based on user ID
function getColorFromUserId(userId: string): string {
  // Simple hash function to get a number from string
  const hash = Array.from(userId).reduce((acc, char) => char.charCodeAt(0) + acc, 0);
  // List of background colors
  const colors = [
    'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-red-500', 
    'bg-indigo-500', 'bg-purple-500', 'bg-pink-500', 'bg-teal-500'
  ];
  return colors[hash % colors.length];
}

// UserList component with Suspense support
type UsersListProps = {
  searchQuery: string
}

async function UsersList({ searchQuery }: UsersListProps) {
  const clerk = await clerkClient();
  
  // If search query is provided, search for matching users, otherwise get all users
  const users = searchQuery 
    ? (await clerk.users.getUserList({ query: searchQuery })).data 
    : (await clerk.users.getUserList()).data;

  // Serialize users to avoid passing non-serializable data to client components
  const serializedUsers: SerializedUser[] = users.map(user => ({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    imageUrl: user.imageUrl,
    emailAddress: user.emailAddresses.find(email => email.id === user.primaryEmailAddressId)?.emailAddress || null,
    roles: (user.publicMetadata?.roles as string[]) || []
  }));

  return (
    <div className="mt-4 bg-white/50 dark:bg-gray-800/50 shadow overflow-hidden sm:rounded-md border border-gray-200 dark:border-gray-700">
      <ul className="divide-y divide-gray-200 dark:divide-gray-700">
        {serializedUsers.length === 0 ? (
          <li className="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
            No users found. Try a different search.
          </li>
        ) : (
          serializedUsers.map((user) => (
            <UserItem 
              key={user.id}
              user={user}
              assignRole={assignRole}
              removeRole={removeRole}
              userRoleEnum={UserRole}
            />
          ))
        )}
      </ul>
    </div>
  );
}

// Loading skeleton for UsersList
function UsersListLoading() {
  return (
    <div className="mt-4 bg-white/50 dark:bg-gray-800/50 shadow overflow-hidden sm:rounded-md border border-gray-200 dark:border-gray-700 animate-pulse">
      <ul className="divide-y divide-gray-200 dark:divide-gray-700">
        {[...Array(5)].map((_, i) => (
          <li key={i} className="px-6 py-4">
            <div className="flex flex-col sm:flex-row sm:items-center">
              <div className="flex items-center mb-3 sm:mb-0">
                <div className="flex-shrink-0 mr-4">
                  <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700"></div>
                </div>
                <div>
                  <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
                  <div className="h-3 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
                  <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:space-x-2 space-y-2 sm:space-y-0 sm:ml-auto mt-3 sm:mt-0">
                <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type PageProps = {
  searchParams: { search?: string }
}

export default async function AdminPage({ searchParams }: PageProps) {
  const { sessionClaims } = await auth();
  const userRoles = (sessionClaims?.metadata as any)?.roles as string[] || [];
  
  // Check if the current user is an admin, redirect if not
  if (!isAdmin(userRoles as UserRole[])) {
    redirect('/')
  }

  // Get search query from searchParams
  const searchQuery = typeof searchParams.search === 'string' ? searchParams.search : '';

  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-12">
      {/* Invitation Management Section with Suspense */}
      <ManageInvitations />

      {/* Users Management Section */}
      <div className="mt-8">
        <h2 className="text-xl font-semibold text-[var(--foreground)]">users</h2>
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
          search and manage existing users.
        </p>
        <div className="mt-4">
          <SearchUsers />
        </div>
      </div>

      {/* User list with Suspense for loading state */}
      <Suspense fallback={<UsersListLoading />}>
        <UsersList searchQuery={searchQuery} />
      </Suspense>
    </div>
  )
} 