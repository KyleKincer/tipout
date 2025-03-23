import Link from 'next/link'

const features = [
  {
    name: 'Daily Tipout Entry',
    description: 'Enter daily shift information and calculate tipouts',
    href: '/shifts/new',
    icon: '📝',
  },
  {
    name: 'Employees',
    description: 'Manage employee information and roles',
    href: '/employees',
    icon: '👥',
  },
  {
    name: 'Roles & Configuration',
    description: 'Configure roles, pay rates, and tipout percentages',
    href: '/roles',
    icon: '⚙️',
  },
  {
    name: 'Reports',
    description: 'View historical tipout data and reports',
    href: '/reports',
    icon: '📊',
  },
]

export default function Home() {
  return (
    <div className="bg-gray-50">
      <div className="mx-auto max-w-7xl py-24 sm:px-6 sm:py-32 lg:px-8">
        <div className="relative isolate overflow-hidden bg-white px-6 py-24 text-center shadow-2xl sm:rounded-3xl sm:px-16">
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Tipout Manager
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-gray-600">
            Streamline your restaurant&apos;s tipout calculations and management
          </p>
          
          <div className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-6 sm:grid-cols-2 lg:mx-0 lg:max-w-none lg:grid-cols-2 lg:gap-8">
            {features.map((feature) => (
              <Link
                key={feature.name}
                href={feature.href}
                className="group relative isolate flex flex-col justify-center overflow-hidden rounded-2xl bg-gray-50 px-6 py-8 hover:bg-gray-100"
              >
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-lg font-semibold leading-8 tracking-tight text-gray-900">
                  {feature.name}
                </h3>
                <p className="mt-2 text-base leading-7 text-gray-600">
                  {feature.description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
