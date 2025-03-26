import ShiftEntryForm from '@/components/ShiftEntryForm'

export default function NewShiftPage() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">Daily Tipout Entry</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            Enter shift information for an employee to calculate their tipout.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <ShiftEntryForm />
      </div>
    </div>
  )
} 