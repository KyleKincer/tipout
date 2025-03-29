import { getInvitations, createInvitation, revokeInvitation } from '@/app/actions/invitationActions';
import { formatDistanceToNow } from 'date-fns';

// Fetch invitations server-side
async function InvitationsList() {
  const { data: invitations, totalCount } = await getInvitations('pending');
  
  return (
    <div className="mt-6">
      <h3 className="text-base font-medium text-[var(--foreground)] mb-4">
        pending invitations ({totalCount})
      </h3>
      
      {invitations.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">no pending invitations</p>
      ) : (
        <>
          {/* Table for larger screens */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    email
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    status
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    created
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-900 dark:divide-gray-700">
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-[var(--foreground)]">
                      {invitation.emailAddress}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-100">
                        {invitation.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {invitation.createdAt ? formatDistanceToNow(new Date(invitation.createdAt), { addSuffix: true }) : 'unknown'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <form action={revokeInvitation}>
                        <input type="hidden" name="invitationId" value={invitation.id} />
                        <button 
                          type="submit"
                          className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                        >
                          Revoke
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Card layout for mobile screens */}
          <div className="sm:hidden space-y-4">
            {invitations.map((invitation) => (
              <div key={invitation.id} className="bg-white dark:bg-gray-900 shadow rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <div className="flex justify-between items-start mb-2">
                  <div className="text-sm font-medium text-[var(--foreground)]">{invitation.emailAddress}</div>
                  <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-100">
                    {invitation.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Created: {invitation.createdAt ? formatDistanceToNow(new Date(invitation.createdAt), { addSuffix: true }) : 'unknown'}
                </div>
                <form action={revokeInvitation}>
                  <input type="hidden" name="invitationId" value={invitation.id} />
                  <button 
                    type="submit"
                    className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 text-sm"
                  >
                    Revoke
                  </button>
                </form>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default async function ManageInvitations() {
  return (
    <div className="bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700 mt-8">
      <div className="px-4 py-5 sm:p-6">
        <h3 className="text-lg font-medium leading-6 text-[var(--foreground)]">manage invitations</h3>
        <div className="mt-2 max-w-xl text-sm text-gray-500 dark:text-gray-400">
          <p>
            invite new users to your application. they will receive an email with a link to sign up.
          </p>
        </div>
        
        <form action={createInvitation} className="mt-5 sm:flex sm:items-center">
          <div className="w-full sm:max-w-xs">
            <label htmlFor="emailAddress" className="sr-only">
              Email address
            </label>
            <input
              type="email"
              name="emailAddress"
              id="emailAddress"
              className="shadow-sm focus:ring-blue-500 focus:border-blue-500 py-2 px-3 block w-full sm:text-sm border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-md"
              placeholder="email@example.com"
              required
            />
          </div>
          <button
            type="submit"
            className="mt-3 w-full inline-flex items-center justify-center px-4 py-2 border border-transparent shadow-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
          >
            invite user
          </button>
        </form>

        {/* List of pending invitations */}
        <InvitationsList />
      </div>
    </div>
  );
} 