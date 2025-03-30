'use client'

import React from 'react'
import { RevokeInvitationButton } from './RevokeInvitationButton'
import { formatDistanceToNow } from 'date-fns'

// Type for invitation data
type Invitation = {
  id: string
  emailAddress: string
  status: string
  createdAt: number | null
}

type InvitationItemProps = {
  invitation: Invitation
  revokeInvitation: (formData: FormData) => Promise<void>
}

export function InvitationItem({ invitation, revokeInvitation }: InvitationItemProps) {
  // Generate a consistent color based on email
  const generateColor = (email: string) => {
    const hash = Array.from(email).reduce((acc, char) => char.charCodeAt(0) + acc, 0);
    const colors = [
      'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-red-500', 
      'bg-indigo-500', 'bg-purple-500', 'bg-pink-500', 'bg-teal-500'
    ];
    return colors[hash % colors.length];
  }

  // Extract first letter of the email as avatar text
  const getEmailInitial = (email: string) => {
    return email.charAt(0).toUpperCase();
  }

  const avatarBgColor = generateColor(invitation.emailAddress);
  const avatarText = getEmailInitial(invitation.emailAddress);

  return (
    <li className="px-6 py-4">
      <div className="flex flex-col sm:flex-row sm:items-center">
        <div className="flex items-center mb-3 sm:mb-0">
          <div className="flex-shrink-0 mr-4">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center text-white ${avatarBgColor}`}>
              {avatarText}
            </div>
          </div>
        
          <div>
            <div className="text-sm font-medium text-[var(--foreground)]">
              {invitation.emailAddress}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-100 mr-2">
                {invitation.status}
              </span>
              <span>
                {invitation.createdAt 
                  ? formatDistanceToNow(new Date(invitation.createdAt), { addSuffix: true }) 
                  : 'unknown'}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row sm:space-x-2 space-y-2 sm:space-y-0 sm:ml-auto mt-3 sm:mt-0">
          <RevokeInvitationButton 
            action={revokeInvitation} 
            invitationId={invitation.id} 
          />
        </div>
      </div>
    </li>
  )
} 