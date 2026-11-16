module.exports = {
  preset: 'ts-jest',
  // convex/_generated is plain ESM JavaScript; let ts-jest compile it too.
  transform: { '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: { allowJs: true, jsx: 'react-jsx' } }] },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@convex/(.*)$': '<rootDir>/convex/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/.tmp/', '/convex/'],
};
