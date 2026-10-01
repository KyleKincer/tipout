let mockSessionClaims: { metadata?: unknown } | null = null;

jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(async () => ({ sessionClaims: mockSessionClaims })),
}));

import { auth } from '@clerk/nextjs/server';
import { getCurrentUserRoles, getRolesFromMetadata, hasRole, isAdmin } from './auth';
import { UserRole } from './roles';

beforeEach(() => {
  mockSessionClaims = null;
  jest.clearAllMocks();
});

describe('Clerk metadata role validation', () => {
  test.each([
    undefined,
    null,
    false,
    1,
    'admin',
    [],
    {},
    { roles: null },
    { roles: 'admin' },
    { roles: { includes: () => true } },
    { roles: ['admin', 1] },
  ].map((metadata) => ({ metadata })))('rejects missing or malformed role metadata: %p', ({ metadata }) => {
    expect(getRolesFromMetadata(metadata)).toEqual([]);
  });

  test('preserves valid custom roles and unrelated public metadata', () => {
    const metadata = { roles: ['admin', 'user', 'future-role'], other: 'unchanged' };
    expect(getRolesFromMetadata(metadata)).toEqual(['admin', 'user', 'future-role']);
    expect(metadata).toEqual({ roles: ['admin', 'user', 'future-role'], other: 'unchanged' });
  });

  test('accepts an explicitly empty role list', () => {
    expect(getRolesFromMetadata({ roles: [] })).toEqual([]);
  });
});

describe('shared server authorization checks', () => {
  test('signed-out sessions have no roles and cannot administer users', async () => {
    await expect(getCurrentUserRoles()).resolves.toEqual([]);
    await expect(isAdmin()).resolves.toBe(false);
    expect(auth).toHaveBeenCalledTimes(2);
  });

  test('reads roles from the existing session metadata claim', async () => {
    mockSessionClaims = { metadata: { roles: [UserRole.ADMIN, UserRole.USER] } };
    await expect(getCurrentUserRoles()).resolves.toEqual([UserRole.ADMIN, UserRole.USER]);
    await expect(hasRole(UserRole.USER)).resolves.toBe(true);
    await expect(isAdmin()).resolves.toBe(true);
  });

  test('a regular user cannot administer users', async () => {
    mockSessionClaims = { metadata: { roles: [UserRole.USER] } };
    await expect(hasRole(UserRole.USER)).resolves.toBe(true);
    await expect(isAdmin()).resolves.toBe(false);
  });

  test.each([
    { roles: 'admin' },
    { roles: ['superadmin'] },
    { roles: ['admin', false] },
  ])(
    'malformed or non-exact role values do not grant admin: %p',
    async ({ roles }) => {
      mockSessionClaims = { metadata: { roles } };
      await expect(isAdmin()).resolves.toBe(false);
    },
  );
});
