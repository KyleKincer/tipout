import type { MutationCtx } from '../../convex/_generated/server';

jest.mock('../../convex/_generated/server', () => ({
  query: (definition: unknown) => definition,
  mutation: (definition: unknown) => definition,
}));
import { update } from '../../convex/employees';
type Handler = { handler: (ctx: MutationCtx, args: Record<string, unknown>) => Promise<unknown> };

function fixture(admin = true) {
  const row = { _id: 'employee', _creationTime: 0, name: 'Original', active: true, createdAt: 0, updatedAt: 10 };
  const patch = jest.fn(async (_id: string, values: Record<string, unknown>) => Object.assign(row, values));
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: 'user', metadata: { roles: admin ? ['admin'] : ['user'] } }) },
    db: { get: async () => row, patch },
  } as unknown as MutationCtx;
  return { ctx, row, patch };
}

test('stale employee drafts fail before overwriting any field', async () => {
  const { ctx, row, patch } = fixture();
  await expect((update as unknown as Handler).handler(ctx, { id: 'employee', name: 'Draft', expectedUpdatedAt: 9 }))
    .rejects.toThrow('Employee changed in another session');
  expect(patch).not.toHaveBeenCalled();
  expect(row.name).toBe('Original');
});

test('valid drafts save with a strictly increasing version even within the same millisecond', async () => {
  const { ctx, row } = fixture();
  const now = jest.spyOn(Date, 'now').mockReturnValue(10);
  try {
    await (update as unknown as Handler).handler(ctx, { id: 'employee', name: 'Draft', expectedUpdatedAt: 10 });
    expect(row.name).toBe('Draft');
    expect(row.updatedAt).toBe(11);
    await expect((update as unknown as Handler).handler(ctx, { id: 'employee', name: 'Stale', expectedUpdatedAt: 10 }))
      .rejects.toThrow('Employee changed in another session');
  } finally { now.mockRestore(); }
});

test('employee edits retain admin-only access', async () => {
  const { ctx, patch } = fixture(false);
  await expect((update as unknown as Handler).handler(ctx, { id: 'employee', name: 'Draft', expectedUpdatedAt: 10 }))
    .rejects.toThrow('Admin required');
  expect(patch).not.toHaveBeenCalled();
});
