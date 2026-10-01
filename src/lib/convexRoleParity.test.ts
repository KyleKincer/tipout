/** In-memory handler tests; deployment validators/transactions still need preview smoke tests. */
jest.mock('../../convex/_generated/server', () => ({
  query: (definition: unknown) => definition,
  mutation: (definition: unknown) => definition,
}));

import * as roles from '../../convex/roles';
import * as roleConfigs from '../../convex/roleConfigs';
import * as employees from '../../convex/employees';
import { roleConfigValidator } from '../../convex/lib/validators';
import { calculateTipouts } from './tipoutCalculations';

type Row = { _id: string; _creationTime: number; [key: string]: unknown };
type Data = Record<string, Row[]>;
const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const FROM = Date.parse('2026-01-01T14:25:33.123Z');
const CLOSED = Date.parse('2026-03-01T14:25:33.456Z');

function setup(seed: Data, admin = true) {
  const data = structuredClone(seed);
  const writes: string[] = [];
  let sequence = 0;
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: 'test', metadata: { roles: admin ? ['admin'] : ['user'] } }) },
    db: {
      get: async (id: string) => Object.values(data).flat().find((row) => row._id === id) ?? null,
      query: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        const builder = { eq: (field: string, value: unknown) => { filters.push([field, value]); return builder; } };
        const result = {
          withIndex: (_name: string, build: (q: typeof builder) => unknown) => { build(builder); return result; },
          collect: async () => (data[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value)),
          first: async () => (await result.collect())[0] ?? null,
        };
        return result;
      },
      insert: async (table: string, values: Record<string, unknown>) => {
        const id = `${table}:new${++sequence}`;
        (data[table] ??= []).push({ _id: id, _creationTime: NOW, ...values });
        writes.push(`insert:${id}`);
        return id;
      },
      patch: async (id: string, values: Record<string, unknown>) => {
        for (const rows of Object.values(data)) {
          const index = rows.findIndex((row) => row._id === id);
          if (index >= 0) rows[index] = { ...rows[index], ...values };
        }
        writes.push(`patch:${id}`);
      },
      delete: async (id: string) => {
        for (const table of Object.keys(data)) data[table] = data[table].filter((row) => row._id !== id);
        writes.push(`delete:${id}`);
      },
    },
  };
  return { ctx, data, writes };
}

type TestContext = ReturnType<typeof setup>['ctx'];
async function run(fn: unknown, ctx: TestContext, args: unknown): Promise<unknown> {
  return (fn as { handler: (ctx: TestContext, args: unknown) => Promise<unknown> }).handler(ctx, args);
}
function config(id: string, extra: Record<string, unknown> = {}): Row {
  return {
    _id: id, _creationTime: FROM, roleId: 'roles:r', legacyId: `legacy:${id}`,
    tipoutType: 'host', percentageRate: 5, effectiveFrom: FROM,
    paysTipout: true, receivesTipout: false, createdAt: FROM, updatedAt: FROM,
    ...extra,
  };
}
function base(configs: Row[] = []): Data {
  return {
    roles: [{ _id: 'roles:r', _creationTime: FROM, name: 'Server', basePayRate: 10, createdAt: FROM, updatedAt: FROM }],
    roleConfigs: configs,
    employees: [{ _id: 'employees:e', _creationTime: FROM, name: 'Employee', active: true, defaultRoleId: 'roles:r', createdAt: FROM, updatedAt: FROM }],
    shifts: [],
  };
}
function payload(row: Row) {
  return {
    id: row._id, tipoutType: row.tipoutType, percentageRate: row.percentageRate,
    effectiveFrom: new Date(row.effectiveFrom as number).toISOString(),
    effectiveTo: row.effectiveTo == null ? null : new Date(row.effectiveTo as number).toISOString(),
    paysTipout: row.paysTipout, receivesTipout: row.receivesTipout,
    distributionGroup: row.distributionGroup ?? null, tipPoolGroup: row.tipPoolGroup ?? null,
  };
}

beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
afterEach(() => jest.restoreAllMocks());

describe('Convex role and pool-only migration parity', () => {
  test('return validator accepts the legacy empty pool-only tipout type', () => {
    expect(roleConfigValidator.fields.tipoutType.members.map((member) => member.value)).toContain('');
  });

  test('role editor receives closed history while the roles list shows current configs', async () => {
    const { ctx } = setup(base([config('closed', { effectiveTo: CLOSED }), config('active', { effectiveFrom: CLOSED })]));
    const full = await run(roles.get, ctx, { id: 'roles:r' }) as { configs: unknown[] };
    const list = await run(roles.list, ctx, {}) as Array<{ configs: unknown[] }>;
    expect(full.configs).toHaveLength(2);
    expect(list[0].configs).toHaveLength(1);
  });

  test('unchanged full round-trip preserves history, exact instants, pool-only membership and legacy identity', async () => {
    const rows = [config('closed', { effectiveTo: CLOSED }), config('pool', { tipoutType: '', paysTipout: false, effectiveFrom: CLOSED, tipPoolGroup: 'servers' })];
    const { ctx, data, writes } = setup(base(rows));
    await run(roleConfigs.replaceForRole, ctx, { roleId: 'roles:r', configs: rows.map(payload) });
    expect(data.roleConfigs).toEqual(rows);
    expect(writes).toEqual([]);
  });

  test('older active-only replacement cannot erase closed history', async () => {
    const closed = config('closed', { effectiveTo: CLOSED });
    const active = config('active', { effectiveFrom: CLOSED });
    const { ctx, data } = setup(base([closed, active]));
    await run(roleConfigs.replaceForRole, ctx, { roleId: 'roles:r', configs: [payload(active)] });
    expect(data.roleConfigs).toEqual([closed, active]);
  });

  test('active advanced edit retains the migrated row identity', async () => {
    const active = config('active');
    const { ctx, data } = setup(base([active]));
    await run(roleConfigs.replaceForRole, ctx, { roleId: 'roles:r', configs: [{ ...payload(active), percentageRate: 6 }] });
    expect(data.roleConfigs[0]).toMatchObject({ _id: 'active', legacyId: 'legacy:active', createdAt: FROM, updatedAt: NOW, percentageRate: 6 });
  });

  test.each([
    [{ ...payload(config('a')), id: undefined, effectiveFrom: 'not-a-date' }],
    [{ ...payload(config('a')), id: 'foreign-config' }],
    [
      { ...payload(config('a')), id: undefined, effectiveFrom: '2026-01-01' },
      { ...payload(config('b')), id: undefined, effectiveFrom: '2026-01-01T00:00:00.000Z' },
    ],
  ])('invalid replacement is rejected before any writes: %p', async (...configs) => {
    const { ctx, writes } = setup(base([config('a')]));
    await expect(run(roleConfigs.replaceForRole, ctx, { roleId: 'roles:r', configs })).rejects.toThrow();
    expect(writes).toEqual([]);
  });

  test('list rate edit expires the old rate and leaves historical payroll unchanged', async () => {
    const previous = config('old');
    const { ctx, data } = setup(base([previous]));
    await run(roleConfigs.setCurrent, ctx, { roleId: 'roles:r', tipoutType: 'host', percentageRate: 12 });
    expect(data.roleConfigs).toHaveLength(2);
    expect(data.roleConfigs[0]).toMatchObject({ _id: 'old', legacyId: 'legacy:old', percentageRate: 5, effectiveFrom: FROM, effectiveTo: NOW });
    expect(data.roleConfigs[1]).toMatchObject({ percentageRate: 12, effectiveFrom: NOW });
    const calcConfigs = data.roleConfigs.map((row) => ({
      id: row._id, tipoutType: String(row.tipoutType), percentageRate: Number(row.percentageRate),
      effectiveFrom: new Date(Number(row.effectiveFrom)).toISOString(),
      effectiveTo: row.effectiveTo == null ? null : new Date(Number(row.effectiveTo)).toISOString(),
      paysTipout: Boolean(row.paysTipout), receivesTipout: Boolean(row.receivesTipout),
    }));
    expect(calculateTipouts({ id: 's', date: '2026-06-01T00:00:00.000Z', hours: 5, cashTips: 0, creditTips: 100, liquorSales: 0, role: { name: 'Server', basePayRate: 10, configs: calcConfigs } }, true, false).hostTipout).toBe(5);
  });

  test('remove current rate expires it rather than erasing it or other tipout types', async () => {
    const { ctx, data } = setup(base([config('old', { effectiveTo: CLOSED }), config('current', { effectiveFrom: CLOSED }), config('bar', { tipoutType: 'bar' })]));
    await run(roleConfigs.endCurrent, ctx, { roleId: 'roles:r', tipoutType: 'host' });
    expect(data.roleConfigs).toHaveLength(3);
    expect(data.roleConfigs.find((row) => row._id === 'old')?.effectiveTo).toBe(CLOSED);
    expect(data.roleConfigs.find((row) => row._id === 'current')?.effectiveTo).toBe(NOW);
    expect(data.roleConfigs.find((row) => row._id === 'bar')?.effectiveTo).toBeUndefined();
  });

  test('new config lifecycle mutations retain admin authorization', async () => {
    const { ctx, writes } = setup(base([config('old')]), false);
    for (const fn of [roleConfigs.setCurrent, roleConfigs.endCurrent]) {
      await expect(run(fn, ctx, { roleId: 'roles:r', tipoutType: 'host', percentageRate: 12 })).rejects.toThrow('Admin required');
    }
    expect(writes).toEqual([]);
  });

  test('deleting an unused role clears employee defaults as Prisma did', async () => {
    const { ctx, data } = setup(base([config('old')]));
    await run(roles.remove, ctx, { id: 'roles:r' });
    expect(data.roles).toEqual([]);
    expect(data.roleConfigs).toEqual([]);
    expect(data.employees[0].defaultRoleId).toBeUndefined();
  });

  test('a role referenced by a shift cannot be deleted or have defaults cleared', async () => {
    const seed = base([config('old')]);
    seed.shifts.push({ _id: 'shifts:s', _creationTime: FROM, roleId: 'roles:r' });
    const { ctx, writes } = setup(seed);
    await expect(run(roles.remove, ctx, { id: 'roles:r' })).rejects.toThrow('Cannot delete role with shifts');
    expect(writes).toEqual([]);
  });

  test('employee update rejects a nonexistent default role but allows clearing it', async () => {
    const { ctx, data, writes } = setup(base());
    await expect(run(employees.update, ctx, { id: 'employees:e', defaultRoleId: 'roles:missing' })).rejects.toThrow('Default role not found');
    expect(writes).toEqual([]);
    await run(employees.update, ctx, { id: 'employees:e', defaultRoleId: null });
    expect(data.employees[0].defaultRoleId).toBeUndefined();
  });
});
