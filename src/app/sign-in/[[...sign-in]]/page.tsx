import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
      <div className="max-w-md w-full space-y-8 p-8 bg-white dark:bg-gray-800 rounded-lg shadow">
        <div>
          <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            sign in to tipout manager
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
            manage your restaurant tipouts efficiently
          </p>
        </div>
        <SignIn
          appearance={{
            elements: {
              rootBox: "mx-auto",
              card: "bg-transparent shadow-none",
            },
          }}
        />
      </div>
    </div>
  );
} 