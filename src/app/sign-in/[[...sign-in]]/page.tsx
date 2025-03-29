'use client';

import { SignIn } from "@clerk/nextjs";
import { useSearchParams } from 'next/navigation';
import { dark } from "@clerk/themes";

export default function SignInPage() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect_url') || '/';
  
  return (
    <div className="flex min-h-screen flex-col items-center justify-center py-12 bg-[var(--background)]">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6">
      </div>

      <div className="flex w-full justify-center">
        <SignIn
          appearance={{
            baseTheme: dark,
          }}
          redirectUrl={redirectUrl}
        />
      </div>
    </div>
  );
} 