import { redirect } from 'next/navigation'
import { SearchUsers } from './SearchUsers'
import { clerkClient, auth } from '@clerk/nextjs/server'
import { assignRole, removeRole } from '@/app/actions/userActions'
import { UserRole, isAdmin } from '@/lib/roles'
import Image from 'next/image'

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

export default async function AdminPage({
  searchParams
}: {
  searchParams: { search?: string }
}) {
  const { sessionClaims } = await auth();
  const userRoles = (sessionClaims?.metadata as any)?.roles as string[] || [];
  
  // Check if the current user is an admin, redirect if not
  if (!isAdmin(userRoles as UserRole[])) {
    redirect('/')
  }

  const query = searchParams.search;
  const clerk = await clerkClient();

  // If search query is provided, search for matching users, otherwise get all users
  const users = query 
    ? (await clerk.users.getUserList({ query })).data 
    : (await clerk.users.getUserList()).data;

  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">admin</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            manage users and their roles.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <SearchUsers />
      </div>

      <div className="mt-4 bg-white/50 dark:bg-gray-800/50 shadow overflow-hidden sm:rounded-md border border-gray-200 dark:border-gray-700">
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {users.map((user) => {
            const userRoles = (user.publicMetadata?.roles as string[]) || [];
            const hasProfileImage = !!user.imageUrl;
            const initials = getInitials(user.firstName, user.lastName);
            const bgColorClass = getColorFromUserId(user.id);
            
            return (
              <li key={user.id} className="px-6 py-4">
                <div className="flex items-center">
                  <div className="flex-shrink-0 mr-4">
                    {hasProfileImage ? (
                      <div className="h-10 w-10 rounded-full overflow-hidden relative">
                        <div className={`absolute inset-0 flex items-center justify-center text-white ${bgColorClass}`}>
                          {initials}
                        </div>
                        <Image 
                          src={user.imageUrl}
                          alt={`${user.firstName || ''} ${user.lastName || ''}`}
                          width={40}
                          height={40}
                          className="h-full w-full object-cover relative z-10"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center text-white ${bgColorClass}`}>
                        {initials}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-[var(--foreground)]">
                        {user.firstName} {user.lastName}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)?.emailAddress}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        <span className="font-medium">Roles:</span> {userRoles.length > 0 ? userRoles.join(", ") : "No roles assigned"}
                      </div>
                    </div>
                    
                    <div className="flex space-x-2">
                      <form action={assignRole}>
                        <input type="hidden" value={user.id} name="userId" />
                        <input type="hidden" value={UserRole.ADMIN} name="role" />
                        <button 
                          type="submit"
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                          disabled={userRoles.includes(UserRole.ADMIN)}
                        >
                          Make Admin
                        </button>
                      </form>
                      
                      <form action={assignRole}>
                        <input type="hidden" value={user.id} name="userId" />
                        <input type="hidden" value={UserRole.USER} name="role" />
                        <button 
                          type="submit"
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                          disabled={userRoles.includes(UserRole.USER)}
                        >
                          Make User
                        </button>
                      </form>
                      
                      {userRoles.map((role) => (
                        <form key={role} action={removeRole}>
                          <input type="hidden" value={user.id} name="userId" />
                          <input type="hidden" value={role} name="role" />
                          <button 
                            type="submit"
                            className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                          >
                            Remove {role}
                          </button>
                        </form>
                      ))}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  )
} 