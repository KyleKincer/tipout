'use client'

import React from 'react'
import Image from 'next/image'
import { UserRoleForm } from './UserRoleForm'

// Define serialized user type
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

type UserItemProps = {
  user: SerializedUser
  assignRole: (formData: FormData) => Promise<void>
  removeRole: (formData: FormData) => Promise<void>
  userRoleEnum: Record<string, string>
}

export function UserItem({ user, assignRole, removeRole, userRoleEnum }: UserItemProps) {
  const userRoles = user.roles;
  const hasProfileImage = !!user.imageUrl;
  const initials = getInitials(user.firstName, user.lastName);
  const bgColorClass = getColorFromUserId(user.id);

  return (
    <li className="px-6 py-4">
      <div className="flex flex-col sm:flex-row sm:items-center">
        <div className="flex items-center mb-3 sm:mb-0">
          <div className="flex-shrink-0 mr-4">
            {hasProfileImage && user.imageUrl ? (
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
        
          <div>
            <div className="text-sm font-medium text-[var(--foreground)]">
              {user.firstName} {user.lastName}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {user.emailAddress}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              <span className="font-medium">Roles:</span> {userRoles.length > 0 ? userRoles.join(", ") : "No roles assigned"}
            </div>
          </div>
        </div>
          
        <div className="flex flex-col sm:flex-row sm:space-x-2 space-y-2 sm:space-y-0 sm:ml-auto mt-3 sm:mt-0">
          <UserRoleForm
            action={assignRole}
            userId={user.id}
            role={userRoleEnum.ADMIN}
            buttonText="Make Admin"
            loadingText="Making Admin..."
            disabled={userRoles.includes(userRoleEnum.ADMIN)}
            buttonClass="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 w-full sm:w-auto"
          />
          
          <UserRoleForm
            action={assignRole}
            userId={user.id}
            role={userRoleEnum.USER}
            buttonText="Make User"
            loadingText="Making User..."
            disabled={userRoles.includes(userRoleEnum.USER)}
            buttonClass="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 w-full sm:w-auto"
          />
          
          {userRoles.map((role) => (
            <UserRoleForm
              key={role}
              action={removeRole}
              userId={user.id}
              role={role}
              buttonText={`Remove ${role}`}
              loadingText={`Removing ${role}...`}
              buttonClass="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 w-full sm:w-auto"
            />
          ))}
        </div>
      </div>
    </li>
  )
} 