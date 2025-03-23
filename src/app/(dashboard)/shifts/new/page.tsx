import ShiftEntryForm from '@/components/ShiftEntryForm'

export default function NewShiftPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Daily Tipout Entry</h1>
        <p className="mt-2 text-sm text-gray-700">
          Enter shift information for an employee to calculate their tipout.
        </p>
      </div>
      <ShiftEntryForm />
    </div>
  )
} 