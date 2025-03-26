import { motion } from 'framer-motion'

export default function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px]">
      <motion.div
        className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full"
        animate={{ rotate: 360 }}
        transition={{
          duration: 1,
          repeat: Infinity,
          ease: "linear"
        }}
      />
      <motion.p
        className="mt-4 text-lg font-medium text-gray-600 dark:text-gray-400"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        loading...
      </motion.p>
    </div>
  )
} 