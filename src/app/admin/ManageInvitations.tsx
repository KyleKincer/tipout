import { getInvitations, createInvitation, revokeInvitation } from '@/app/actions/invitationActions';
import { Suspense } from 'react';
import { InvitationForm } from './components/InvitationForm';
import { InvitationItem } from './components/InvitationItem';

// Type for serialized invitation data
type SerializedInvitation = {
  id: string;
  emailAddress: string;
  status: string;
  createdAt: number | null;
};

// Loading component for invitation list
function InvitationsListLoading() {
  return (
    <div className="mt-6">
      <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
      <div className="bg-white/50 dark:bg-gray-800/50 shadow overflow-hidden sm:rounded-md border border-gray-200 dark:border-gray-700 animate-pulse">
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {[...Array(3)].map((_, i) => (
            <li key={i} className="px-6 py-4">
              <div className="flex flex-col sm:flex-row sm:items-center">
                <div className="flex items-center mb-3 sm:mb-0">
                  <div className="flex-shrink-0 mr-4">
                    <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700"></div>
                  </div>
                  <div>
                    <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
                    <div className="h-3 w-40 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:space-x-2 space-y-2 sm:space-y-0 sm:ml-auto mt-3 sm:mt-0">
                  <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Fetch invitations server-side
async function InvitationsList() {
  const { data: invitations, totalCount } = await getInvitations('pending');
  
  // Serialize the invitations data to avoid passing non-serializable data to client components
  const serializedInvitations: SerializedInvitation[] = invitations.map(invitation => ({
    id: invitation.id,
    emailAddress: invitation.emailAddress,
    status: invitation.status,
    createdAt: invitation.createdAt
  }));
  
  return (
    <div className="mt-6">
      <h3 className="text-base font-medium text-[var(--foreground)] mb-4">
        pending invitations ({totalCount})
      </h3>
      
      <div className="bg-white/50 dark:bg-gray-800/50 shadow overflow-hidden sm:rounded-md border border-gray-200 dark:border-gray-700">
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {serializedInvitations.length === 0 ? (
            <li className="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
              No pending invitations.
            </li>
          ) : (
            serializedInvitations.map((invitation) => (
              <InvitationItem 
                key={invitation.id}
                invitation={invitation}
                revokeInvitation={revokeInvitation}
              />
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

export default function ManageInvitations() {
  return (
    <div className="mt-8">
      <h2 className="text-xl font-semibold text-[var(--foreground)]">manage invitations</h2>
      <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
        invite new users to tipout. they will receive an email with a link to sign up.
      </p>
      
      <InvitationForm action={createInvitation} />

      {/* List of pending invitations with suspense for loading */}
      <Suspense fallback={<InvitationsListLoading />}>
        <InvitationsList />
      </Suspense>
    </div>
  );
} 