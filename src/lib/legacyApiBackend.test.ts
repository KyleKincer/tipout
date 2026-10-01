jest.mock('../../convex/_generated/server', () => ({ query: (definition: unknown) => definition }));
import * as legacyApi from '../../convex/legacyApi';
import { ConvexError } from 'convex/values';

type Row = { _id: string; [key: string]: unknown };
function context(data: Record<string, Row[]>, identity: unknown = { subject: 'user', metadata: { roles: ['user'] } }) {
  let reads = 0;
  const ctx = {
    auth: { getUserIdentity: async () => identity },
    db: {
      normalizeId: (table: string, id: string) => id.startsWith(`${table}:`) ? id : null,
      get: async (id: string) => { reads++; return Object.values(data).flat().find((row) => row._id === id) ?? null; },
      query: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        const builder = { eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; } };
        const collect = async () => { reads++; return (data[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value)); };
        const result = { withIndex: (_name: string, fn: (q: typeof builder) => void) => { fn(builder); return result; }, collect, take: async (n: number) => (await collect()).slice(0, n) };
        return result;
      },
    },
  };
  return { ctx, reads: () => reads };
}
async function run(fn: unknown, ctx: ReturnType<typeof context>['ctx'], args: unknown) {
  return (fn as { handler: (ctx: unknown, args: unknown) => Promise<unknown> }).handler(ctx, args);
}
const config = { _id: 'roleConfigs:c', roleId: 'roles:r', tipoutType: 'bar', percentageRate: 5, effectiveFrom: 100, receivesTipout: false, paysTipout: true, createdAt: 0, updatedAt: 0 };

test.each([
  [legacyApi.checkAccess, { admin: false }],
  [legacyApi.resolveIds, { refs: [{ table: 'employees', id: 'cuid' }] }],
  [legacyApi.configsForRoles, { roleIds: ['roles:r'], start: 100, end: 200 }],
])('anonymous legacy helper is rejected before data access', async (fn, args) => {
  const state = context({}, null);
  await expect(run(fn, state.ctx, args)).rejects.toThrow('Not authenticated'); expect(state.reads()).toBe(0);
});

test('staff reads are allowed but admin assertion remains restricted', async () => {
  const state = context({});
  await expect(run(legacyApi.checkAccess, state.ctx, { admin: false })).resolves.toBeNull();
  await expect(run(legacyApi.checkAccess, state.ctx, { admin: true })).rejects.toThrow('Admin required');
  const admin = context({}, { subject: 'admin', publicMetadata: { roles: ['admin'] } });
  await expect(run(legacyApi.checkAccess, admin.ctx, { admin: true })).resolves.toBeNull();
});

test('legacy/native input IDs resolve consistently and unknown IDs do not match names', async () => {
  const state = context({ employees: [{ _id: 'employees:e', legacyId: 'cuid', name: 'Missing' }, { _id: 'employees:new', name: 'New' }] });
  expect(await run(legacyApi.resolveIds, state.ctx, { refs: [
    { table: 'employees', id: 'cuid' }, { table: 'employees', id: 'employees:e' },
    { table: 'employees', id: 'employees:new' }, { table: 'employees', id: 'Missing' },
  ] })).toEqual([
    { table: 'employees', input: 'cuid', id: 'employees:e', publicId: 'cuid' },
    { table: 'employees', input: 'employees:e', id: 'employees:e', publicId: 'cuid' },
    { table: 'employees', input: 'employees:new', id: 'employees:new', publicId: 'employees:new' },
    { table: 'employees', input: 'Missing', id: null, publicId: null },
  ]);
});

test('duplicate legacy identities fail closed instead of selecting an arbitrary employee', async () => {
  const state = context({ employees: [{ _id: 'employees:a', legacyId: 'cuid' }, { _id: 'employees:b', legacyId: 'cuid' }] });
  await expect(run(legacyApi.resolveIds, state.ctx, { refs: [{ table: 'employees', id: 'cuid' }] })).rejects.toThrow('Ambiguous legacy identity');
});

test('missing native-shaped ID still checks exact legacy mapping', async () => {
  const state = context({ employees: [{ _id: 'employees:new', legacyId: 'employees:old' }] });
  expect(await run(legacyApi.resolveIds, state.ctx, { refs: [{ table: 'employees', id: 'employees:old' }] })).toEqual([
    { table: 'employees', input: 'employees:old', id: 'employees:new', publicId: 'employees:old' },
  ]);
});

test('legacy config list window includes current/future-open rows and inclusive closed overlaps', async () => {
  const rows = [
    { ...config, _id: 'roleConfigs:before', effectiveTo: 99 },
    { ...config, _id: 'roleConfigs:boundaryStart', effectiveTo: 100 },
    { ...config, _id: 'roleConfigs:overlap', effectiveFrom: 150, effectiveTo: 175 },
    { ...config, _id: 'roleConfigs:boundaryEnd', effectiveFrom: 200, effectiveTo: 300 },
    { ...config, _id: 'roleConfigs:after', effectiveFrom: 201, effectiveTo: 300 },
    { ...config, _id: 'roleConfigs:futureOpen', effectiveFrom: 1000 },
    { ...config, _id: 'roleConfigs:other', roleId: 'roles:other' },
  ];
  const state = context({ roleConfigs: rows });
  const result = await run(legacyApi.configsForRoles, state.ctx, { roleIds: ['roles:r'], start: 100, end: 200 }) as Array<{ configs: Array<{ id: string }> }>;
  expect(result[0].configs.map((row) => row.id)).toEqual(['roleConfigs:boundaryStart', 'roleConfigs:overlap', 'roleConfigs:boundaryEnd', 'roleConfigs:futureOpen']);
});

test('identity and config role batches are bounded before data access', async () => {
  const state = context({});
  await expect(run(legacyApi.resolveIds, state.ctx, { refs: Array(257).fill({ table: 'employees', id: 'cuid' }) })).rejects.toBeInstanceOf(ConvexError);
  await expect(run(legacyApi.configsForRoles, state.ctx, { roleIds: Array(257).fill('roles:r'), start: 0, end: 1 })).rejects.toBeInstanceOf(ConvexError);
  expect(state.reads()).toBe(0);
});
