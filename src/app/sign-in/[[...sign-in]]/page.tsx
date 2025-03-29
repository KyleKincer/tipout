'use client';

import { SignIn } from "@clerk/nextjs";
import { useSearchParams } from 'next/navigation';

export default function SignInPage() {
  // Client-side component that will run in the browser
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
      <div className="max-w-md w-full space-y-8 p-8 bg-white dark:bg-gray-800 rounded-lg shadow">
        <div>
          <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            sign in to tipout manager
          </h2>
        </div>
        <SignInWithRedirect />
      </div>
    </div>
  );
}

// Client component to handle the redirect
function SignInWithRedirect() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect_url') || '/';
  
  return (
    <SignIn
      appearance={{
        elements: {
          rootBox: "mx-auto",
          card: "bg-transparent shadow-none",
        },
      }}
      redirectUrl={redirectUrl}
    />
  );
} 