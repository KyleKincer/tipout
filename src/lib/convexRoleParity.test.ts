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
      normalizeId: (_table: string, id: string) => id.includes(':') ? id : null,
      get: async (id: string) => Object.values(data).flat().find((row) => row._id === id) ?? null,
      query: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        const builder = { eq: (field: string, value: unknown) => { filters.push([field, value]); return builder; } };
        const result = {
          withIndex: (_name: string, build: (q: typeof builder) => unknown) => { build(builder); return result; },
          collect: async () => (data[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value)),
          first: async () => (await result.collect())[0] ?? null,
          take: async (count: number) => (await result.collect()).slice(0, count),
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

function snapshot(data: Data) {
  return {
    roleUpdatedAt: Number(data.roles[0].updatedAt),
    configs: data.roleConfigs.map((row) => ({ id: row._id, updatedAt: Number(row.updatedAt) })),
  };
}
function advancedArgs(data: Data) {
  return {
    roleId: 'roles:r', name: 'Changed name', basePayRate: 20,
    configs: data.roleConfigs.map(payload), expected: snapshot(data),
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

  test('legacy role bookmark resolves the native ID and all historical configs', async () => {
    const seed = base([config('past', { effectiveTo: CLOSED }), config('current', { effectiveFrom: CLOSED })]);
    seed.roles[0].legacyId = 'legacyrolecuid';
    const { ctx } = setup(seed);
    const result = await run(roles.get, ctx, { id: 'legacyrolecuid' }) as { id: string; configs: unknown[] };
    expect(result.id).toBe('roles:r');
    expect(result.configs).toHaveLength(2);
  });

  test('unchanged full round-trip preserves history, exact instants, pool-only membership and legacy identity', async () => {
    const rows = [config('closed', { effectiveTo: CLOSED }), config('pool', { tipoutType: '', paysTipout: false, effectiveFrom: CLOSED, tipPoolGroup: 'servers' })];
    const { ctx, data, writes } = setup(base(rows));
    await run(roleConfigs.replaceForRole, ctx, { roleId: 'roles:r', expected: snapshot(data), configs: rows.map(payload) });
    expect(data.roleConfigs).toEqual(rows);
    expect(writes).toEqual([]);
  });

  test('older active-only replacement cannot erase closed history', async () => {
    const closed = config('closed', { effectiveTo: CLOSED });
    const active = config('active', { effectiveFrom: CLOSED });
    const { ctx, data } = setup(base([closed, active]));
    await run(roleConfigs.replaceForRole, ctx, { roleId: 'roles:r', expected: snapshot(data), configs: [payload(active)] });
    expect(data.roleConfigs).toEqual([closed, active]);
  });

  test('active advanced edit retains the migrated row identity', async () => {
    const active = config('active');
    const { ctx, data } = setup(base([active]));
    await run(roleConfigs.replaceForRole, ctx, { roleId: 'roles:r', expected: snapshot(data), configs: [{ ...payload(active), percentageRate: 6 }] });
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
    const { ctx, data, writes } = setup(base([config('a')]));
    await expect(run(roleConfigs.replaceForRole, ctx, { roleId: 'roles:r', expected: snapshot(data), configs })).rejects.toThrow();
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


describe('optimistic concurrency and atomic advanced role saves', () => {
  test('stale advanced save cannot reopen expired X, delete new Y, or partially update role fields', async () => {
    const { ctx, data, writes } = setup(base([config('x')]));
    const stale = advancedArgs(data);
    await run(roleConfigs.setCurrent, ctx, { roleId: 'roles:r', tipoutType: 'host', percentageRate: 12 });
    const beforeSave = structuredClone(data);
    writes.length = 0;
    await expect(run(roleConfigs.saveRoleWithConfigs, ctx, stale)).rejects.toThrow('changed while you were editing');
    expect(writes).toEqual([]);
    expect(data).toEqual(beforeSave);
  });

  test.each(['added', 'deleted', 'updated'] as const)('complete snapshot detects a concurrently %s config before any writes', async (change) => {
    const { ctx, data, writes } = setup(base([config('x'), config('other', { tipoutType: 'bar' })]));
    const stale = advancedArgs(data);
    if (change === 'added') await ctx.db.insert('roleConfigs', config('new', { tipoutType: 'sa' }));
    if (change === 'deleted') await ctx.db.delete('other');
    if (change === 'updated') await ctx.db.patch('other', { updatedAt: NOW, percentageRate: 10 });
    const beforeSave = structuredClone(data);
    writes.length = 0;
    await expect(run(roleConfigs.saveRoleWithConfigs, ctx, stale)).rejects.toThrow('changed while you were editing');
    await expect(run(roleConfigs.replaceForRole, ctx, { roleId: stale.roleId, configs: stale.configs, expected: stale.expected })).rejects.toThrow('changed while you were editing');
    expect(writes).toEqual([]);
    expect(data).toEqual(beforeSave);
  });

  test('concurrent role name or pay edit blocks the stale complete save', async () => {
    const { ctx, data, writes } = setup(base([config('x')]));
    const stale = advancedArgs(data);
    await run(roles.update, ctx, { id: 'roles:r', basePayRate: 30 });
    const beforeSave = structuredClone(data);
    writes.length = 0;
    await expect(run(roleConfigs.saveRoleWithConfigs, ctx, stale)).rejects.toThrow('changed while you were editing');
    expect(writes).toEqual([]);
    expect(data).toEqual(beforeSave);
  });

  test('unchanged valid advanced roundtrip preserves every row and timestamp', async () => {
    const { ctx, data, writes } = setup(base([config('x'), config('past', { tipoutType: 'sa', effectiveTo: CLOSED })]));
    const beforeSave = structuredClone(data);
    await run(roleConfigs.saveRoleWithConfigs, ctx, { ...advancedArgs(data), name: 'Server', basePayRate: 10 });
    expect(writes).toEqual([]);
    expect(data).toEqual(beforeSave);
  });

  test('valid complete save updates role and config together', async () => {
    const { ctx, data } = setup(base([config('x')]));
    const args = advancedArgs(data);
    args.configs[0].percentageRate = 9;
    await run(roleConfigs.saveRoleWithConfigs, ctx, args);
    expect(data.roles[0]).toMatchObject({ name: 'Changed name', basePayRate: 20, updatedAt: NOW });
    expect(data.roleConfigs[0]).toMatchObject({ percentageRate: 9, updatedAt: NOW, legacyId: 'legacy:x' });
  });

  test('invalid config payload cannot partially save role fields or create a new role', async () => {
    const { ctx, data, writes } = setup(base([config('x')]));
    const args = advancedArgs(data);
    args.configs[0].effectiveFrom = 'invalid-date';
    await expect(run(roleConfigs.saveRoleWithConfigs, ctx, args)).rejects.toThrow('Invalid configuration date');
    await expect(run(roleConfigs.saveRoleWithConfigs, ctx, { ...args, roleId: undefined, expected: null, configs: [{ ...args.configs[0], id: undefined }] })).rejects.toThrow('Invalid configuration date');
    expect(writes).toEqual([]);
  });

  test('missing or incomplete snapshots cannot use config replacement as an unguarded path', async () => {
    const { ctx, data, writes } = setup(base([config('x')]));
    await expect(run(roleConfigs.replaceForRole, ctx, { roleId: 'roles:r', configs: [] })).rejects.toThrow('changed while you were editing');
    await expect(run(roleConfigs.replaceForRole, ctx, { roleId: 'roles:r', configs: [], expected: { ...snapshot(data), configs: [] } })).rejects.toThrow('changed while you were editing');
    await expect(run(roleConfigs.saveRoleWithConfigs, ctx, { ...advancedArgs(data), expected: null })).rejects.toThrow('changed while you were editing');
    expect(writes).toEqual([]);
  });

  test('snapshot order is irrelevant but duplicate IDs cannot conceal a missing row', async () => {
    const { ctx, data, writes } = setup(base([config('x'), config('y', { tipoutType: 'sa' })]));
    const args = advancedArgs(data);
    args.name = 'Server';
    args.basePayRate = 10;
    args.expected.configs.reverse();
    await run(roleConfigs.saveRoleWithConfigs, ctx, args);
    expect(writes).toEqual([]);
    args.expected.configs = [args.expected.configs[0], args.expected.configs[0]];
    await expect(run(roleConfigs.saveRoleWithConfigs, ctx, args)).rejects.toThrow('changed while you were editing');
    expect(writes).toEqual([]);
  });

  test('same-millisecond updates still advance role and config versions', async () => {
    const seed = base([config('x', { updatedAt: NOW })]);
    seed.roles[0].updatedAt = NOW;
    const { ctx, data, writes } = setup(seed);
    const stale = advancedArgs(data);
    await run(roles.update, ctx, { id: 'roles:r', name: 'Concurrent name' });
    expect(data.roles[0].updatedAt).toBe(NOW + 1);
    writes.length = 0;
    await expect(run(roleConfigs.saveRoleWithConfigs, ctx, stale)).rejects.toThrow('changed while you were editing');
    expect(writes).toEqual([]);
    const beforeConfig = advancedArgs(data);
    await run(roleConfigs.endCurrent, ctx, { roleId: 'roles:r', tipoutType: 'host' });
    expect(data.roleConfigs[0].updatedAt).toBe(NOW + 1);
    writes.length = 0;
    await expect(run(roleConfigs.saveRoleWithConfigs, ctx, beforeConfig)).rejects.toThrow('changed while you were editing');
    expect(writes).toEqual([]);
  });

  test('new role and pool-only config are saved by the same mutation', async () => {
    const { ctx, data } = setup({ roles: [], roleConfigs: [], employees: [], shifts: [] });
    await run(roleConfigs.saveRoleWithConfigs, ctx, {
      name: 'New pool role', basePayRate: 10, expected: null,
      configs: [{ ...payload(config('draft', { tipoutType: '', paysTipout: false, tipPoolGroup: 'servers' })), id: undefined }],
    });
    expect(data.roles).toHaveLength(1);
    expect(data.roleConfigs).toHaveLength(1);
    expect(data.roleConfigs[0]).toMatchObject({ roleId: data.roles[0]._id, tipoutType: '', tipPoolGroup: 'servers' });
  });

  test('legacy set-current API flags remain supported', async () => {
    const { ctx, data } = setup(base());
    await run(roleConfigs.setCurrent, ctx, { roleId: 'roles:r', tipoutType: 'host', percentageRate: 0, receivesTipout: true, paysTipout: false, distributionGroup: 'hosts' });
    expect(data.roleConfigs[0]).toMatchObject({ receivesTipout: true, paysTipout: false, distributionGroup: 'hosts' });
  });
});
