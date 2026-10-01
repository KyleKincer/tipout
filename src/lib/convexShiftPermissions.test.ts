import type { MutationCtx } from '../../convex/_generated/server';

jest.mock('../../convex/_generated/server', () => ({
  query: (definition: unknown) => definition,
  mutation: (definition: unknown) => definition,
}));
import { create, update, remove } from '../../convex/shifts';
type Handler = { handler: (ctx: MutationCtx, args: Record<string, unknown>) => Promise<unknown> };

function fixture(authenticated = true, admin = false) {
  const employee = { _id: 'employee', _creationTime: 0, name: 'Employee', active: true, createdAt: 0, updatedAt: 0 };
  const role = { _id: 'role', _creationTime: 0, name: 'Role', basePayRate: 0, createdAt: 0, updatedAt: 0 };
  let shift: Record<string, unknown> | null = null;
  const insert = jest.fn(async (_table: string, doc: Record<string, unknown>) => { shift = { ...doc, _id: 'shift', _creationTime: 0 }; return 'shift'; });
  const ctx = {
    auth: { getUserIdentity: async () => authenticated ? ({ subject: 'staff', metadata: { roles: admin ? ['admin'] : ['user'] } }) : null },
    db: {
      get: async (id: string) => id === 'employee' ? employee : id === 'role' ? role : id === 'shift' ? shift : null,
      insert,
      query: () => ({ withIndex: () => ({ collect: async () => [] }) }),
      patch: jest.fn(), delete: jest.fn(),
    },
  } as unknown as MutationCtx;
  return { ctx, insert };
}
const args = { employeeId: 'employee', roleId: 'role', date: '2026-10-01', hours: 5 };

test('ordinary signed-in staff can create a shift as in the legacy New Shift workflow', async () => {
  const { ctx, insert } = fixture();
  const result = await (create as unknown as Handler).handler(ctx, args) as { id: string; employeeId: string };
  expect(insert).toHaveBeenCalledTimes(1);
  expect(result.id).toBe('shift');
  expect(result.employeeId).toBe('employee');
});

test('anonymous requests cannot create shifts', async () => {
  const { ctx, insert } = fixture(false);
  await expect((create as unknown as Handler).handler(ctx, args)).rejects.toThrow('Not authenticated');
  expect(insert).not.toHaveBeenCalled();
});

test.each([['edit', update], ['delete', remove]])('ordinary staff cannot %s shifts', async (_name, mutation) => {
  const { ctx } = fixture();
  await expect((mutation as unknown as Handler).handler(ctx, { ...args, id: 'shift' })).rejects.toThrow('Admin required');
});


test.each(['employeeId', 'roleId'])('shift update rejects missing %s inside its write transaction', async field => {
  const { ctx } = fixture(true, true);
  await (create as unknown as Handler).handler(ctx, args);
  await expect((update as unknown as Handler).handler(ctx, { ...args, id: 'shift', [field]: 'missing' })).rejects.toThrow('not found');
  expect(ctx.db.patch).not.toHaveBeenCalled();
});


test('malformed signed role claims cannot grant admin access', async () => {
  const { ctx } = fixture(true, true);
  ctx.auth.getUserIdentity = async () => ({ subject: 'staff', issuer: 'https://issuer.invalid', tokenIdentifier: 'issuer|staff', metadata: { roles: ['admin', 123] } });
  await expect((remove as unknown as Handler).handler(ctx, { id: 'shift' })).rejects.toThrow('Admin required');
});
