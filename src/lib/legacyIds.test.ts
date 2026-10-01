import type { QueryCtx } from '../../convex/_generated/server';
import { resolveLegacyDoc } from '../../convex/lib/legacyIds';
import { resolveEmployeeFilterId } from './employeeFilter';

function database(table: string, rows: Array<{ _id: string; legacyId?: string }>) {
  let requestedLegacy = '';
  const ctx = { db: {
    normalizeId: (_table: string, id: string) => id.startsWith('native-') ? id : null,
    get: async (id: string) => rows.find(row => row._id === id) ?? null,
    query: (requestedTable: string) => {
      expect(requestedTable).toBe(table);
      return { withIndex: (index: string, filter: (q: unknown) => unknown) => {
        expect(index).toBe('by_legacy');
        const builder = { eq: (field: string, value: string) => { expect(field).toBe('legacyId'); requestedLegacy = value; return builder; } };
        filter(builder);
        return { take: async (count: number) => rows.filter(row => row.legacyId === requestedLegacy).slice(0, count) };
      } };
    },
  } } as unknown as QueryCtx;
  return ctx;
}

test.each(['employees', 'roles', 'shifts', 'roleConfigs'] as const)('%s resolves native and legacy bookmarks exactly', async table => {
  const row = { _id: 'native-one', legacyId: 'old-cuid' };
  const ctx = database(table, [row]);
  expect(await resolveLegacyDoc(ctx, table, 'native-one')).toEqual(row);
  expect(await resolveLegacyDoc(ctx, table, 'old-cuid')).toEqual(row);
  expect(await resolveLegacyDoc(ctx, table, 'missing')).toBeNull();
  expect(await resolveLegacyDoc(ctx, table, '')).toBeNull();
});

test('fails closed on duplicate legacy mappings and resolves native-looking source IDs', async () => {
  const duplicate = database('employees', [{ _id: 'native-a', legacyId: 'old' }, { _id: 'native-b', legacyId: 'old' }]);
  await expect(resolveLegacyDoc(duplicate, 'employees', 'old')).rejects.toThrow('Ambiguous legacy identity');
  const nativeLooking = { _id: 'native-a', legacyId: 'native-old-source' };
  expect(await resolveLegacyDoc(database('employees', [nativeLooking]), 'employees', 'native-old-source')).toEqual(nativeLooking);
});

test('report and shift filters preserve old employee bookmarks and never merge by name', () => {
  const employees = [{ id: 'native-a', legacyId: 'old-a' }, { id: 'native-b', legacyId: 'old-b' }];
  expect(resolveEmployeeFilterId(employees, 'old-b')).toBe('native-b');
  expect(resolveEmployeeFilterId([...employees, employees[1]], 'old-b')).toBe('native-b');
  expect(resolveEmployeeFilterId(employees, 'native-a')).toBe('native-a');
  expect(resolveEmployeeFilterId(employees, 'missing')).toBe('missing');
  expect(resolveEmployeeFilterId(undefined, 'old-b')).toBe('old-b');
  expect(resolveEmployeeFilterId(employees, '')).toBe('');
  expect(resolveEmployeeFilterId([{ id: 'a', legacyId: 'old' }, { id: 'b', legacyId: 'old' }], 'old')).toBe('old');
});
