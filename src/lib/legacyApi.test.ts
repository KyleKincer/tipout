jest.mock('@clerk/nextjs/server', () => ({ auth: jest.fn() }));
jest.mock('convex/browser', () => ({ ConvexHttpClient: jest.fn() }));

import { auth } from '@clerk/nextjs/server';
import { ConvexHttpClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import { ConvexError } from 'convex/values';
import { handleLegacyApi } from './legacyApi';
import { collectIdReferences, serializeLegacyIds } from './legacyApiContract';
import fs from 'node:fs';
import path from 'node:path';

const DATE = '2026-10-01T00:00:00.000Z';
const role = { id: 'roles:r', name: 'Server', basePayRate: 9.5, createdAt: DATE, updatedAt: DATE };
const employee = { id: 'employees:e', legacyId: 'cuidEmployee', name: 'Employee', active: true, defaultRoleId: 'roles:r', createdAt: DATE, updatedAt: DATE };
const config = { id: 'roleConfigs:c', roleId: 'roles:r', tipoutType: 'bar', percentageRate: 2.5, effectiveFrom: DATE, effectiveTo: null, receivesTipout: false, paysTipout: true, distributionGroup: null, tipPoolGroup: 'servers', createdAt: DATE, updatedAt: DATE };
const shift = { id: 'shifts:s', employeeId: 'employees:e', roleId: 'roles:r', date: DATE, hours: 8, cashTips: 12, creditTips: 30, liquorSales: 100, createdAt: DATE, updatedAt: DATE, employee, role: { ...role, configs: [config] } };
const ids = [
  { table: 'employees', id: employee.id, publicId: 'cuidEmployee' },
  { table: 'roles', id: role.id, publicId: 'cuidRole' },
  { table: 'roleConfigs', id: config.id, publicId: 'uuidConfig' },
  { table: 'shifts', id: shift.id, publicId: 'cuidShift' },
  { table: 'employees', id: 'employees:new', publicId: 'employees:new' },
];
let isAdmin = true;
let responses: Record<string, unknown>;
let query: jest.Mock;
let mutation: jest.Mock;
let setAuth: jest.Mock;
let getToken: jest.Mock;

beforeEach(() => {
  isAdmin = true;
  responses = {
    'employees:list': [{ ...employee, defaultRole: role }], 'employees:get': { ...employee, defaultRole: role },
    'employees:create': { ...employee, defaultRole: null, defaultRoleId: null }, 'employees:update': { ...employee, defaultRole: role },
    'roles:list': [{ ...role, configs: [config] }], 'roles:get': { ...role, configs: [config, { ...config, id: config.id, effectiveTo: DATE }] },
    'roles:create': { ...role, configs: [] }, 'roles:update': { ...role, configs: [config] },
    'roleConfigs:listForRole': [config], 'roleConfigs:listCurrentForRole': [config], 'roleConfigs:setCurrent': config,
    'roleConfigs:endCurrent': { success: true }, 'employees:remove': { success: true }, 'roles:remove': { success: true }, 'shifts:remove': { success: true },
    'shifts:list': [shift], 'shifts:get': shift, 'shifts:create': shift, 'shifts:update': shift,
    'legacyApi:configsForRoles': [{ roleId: role.id, configs: [config] }],
    'reports:get': { summary: { totalHours: 8 }, employeeSummaries: [{ employeeId: employee.id, employeeName: employee.name }], roleConfigs: { Server: { barTipout: 2.5, hostTipout: 0, sa: 0 } } },
    'tipPoolGroups:list': ['servers'],
  };
  query = jest.fn(async (ref, args) => {
    const name = getFunctionName(ref);
    if (name === 'legacyApi:checkAccess') {
      if (args.admin && !isAdmin) throw new ConvexError('Admin required');
      return null;
    }
    if (name === 'legacyApi:resolveIds') return args.refs.map((item: { table: string; id: string }) => {
      const row = ids.find((row) => row.table === item.table && (row.id === item.id || row.publicId === item.id));
      return { table: item.table, input: item.id, id: row?.id ?? null, publicId: row?.publicId ?? null };
    });
    return responses[name];
  });
  mutation = jest.fn(async (ref) => responses[getFunctionName(ref)]);
  setAuth = jest.fn();
  getToken = jest.fn().mockResolvedValue('user-jwt');
  (auth as unknown as jest.Mock).mockResolvedValue({ userId: 'clerk-user', getToken });
  (ConvexHttpClient as unknown as jest.Mock).mockImplementation(() => ({ query, mutation, setAuth }));
  process.env.NEXT_PUBLIC_CONVEX_URL = 'https://test.convex.cloud';
});

async function request(resource: Parameters<typeof handleLegacyApi>[0], method = 'GET', body?: unknown, suffix = '', id = 'cuidRole', headers: Record<string, string> = {}) {
  const response = await handleLegacyApi(resource, new Request(`https://tipout.example/api/test${suffix}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { params: Promise.resolve({ id }) });
  return { status: response.status, value: await response.json(), headers: response.headers };
}
function callArgs(mock: jest.Mock, name: string) { return mock.mock.calls.filter(([ref]) => getFunctionName(ref) === name).map(([, args]) => args); }
const routes: Array<[string, Parameters<typeof handleLegacyApi>[0], string[]]> = [
  ['employees', 'employees', ['GET', 'POST']], ['employees/[id]', 'employee', ['GET', 'PUT', 'DELETE']],
  ['roles', 'roles', ['GET', 'POST']], ['roles/[id]', 'role', ['GET', 'PUT', 'PATCH', 'DELETE']],
  ['roles/[id]/config', 'configs', ['GET', 'PUT']], ['roles/[id]/configurations', 'configurations', ['GET', 'POST', 'DELETE']],
  ['shifts', 'shifts', ['GET', 'POST']], ['shifts/[id]', 'shift', ['GET', 'PUT', 'DELETE']],
  ['reports', 'reports', ['GET']], ['tip-pool-groups', 'groups', ['GET']],
];

test('all 10 legacy route paths and 23 HTTP methods exist and are dynamic', () => {
  expect(routes.flatMap(([, , methods]) => methods)).toHaveLength(23);
  for (const [file, resource, methods] of routes) {
    const text = fs.readFileSync(path.join(__dirname, '../app/api', file, 'route.ts'), 'utf8');
    expect(text).toContain("export const dynamic = 'force-dynamic'");
    for (const method of methods) expect(text).toContain(`export function ${method}(`);
    expect(text).toContain(`handleLegacyApi('${resource}'`);
  }
});

test.each(routes.flatMap(([, resource, methods]) => methods.map((method) => [resource, method])))('anonymous %s %s is 401 before backend reads or writes', async (resource, method) => {
  (auth as unknown as jest.Mock).mockResolvedValue({ userId: null, getToken });
  expect((await request(resource as Parameters<typeof request>[0], method)).status).toBe(401);
  expect(query).not.toHaveBeenCalled(); expect(mutation).not.toHaveBeenCalled(); expect(getToken).not.toHaveBeenCalled();
});

test.each(routes.flatMap(([, resource, methods]) => methods.filter((method) => method !== 'GET' && !(resource === 'shifts' && method === 'POST')).map((method) => [resource, method])))('staff cannot perform %s %s', async (resource, method) => {
  isAdmin = false;
  expect((await request(resource as Parameters<typeof request>[0], method)).status).toBe(403);
  expect(mutation).not.toHaveBeenCalled();
});

test('signed-in staff may create shifts with legacy foreign keys and numeric strings', async () => {
  isAdmin = false;
  const result = await request('shifts', 'POST', { employeeId: 'cuidEmployee', roleId: 'cuidRole', date: '2026-10-01', hours: '8', cashTips: '12', creditTips: '30', liquorSales: '100' });
  expect(result.status).toBe(200);
  expect(callArgs(mutation, 'shifts:create')).toEqual([{ employeeId: employee.id, roleId: role.id, date: '2026-10-01', hours: 8, cashTips: 12, creditTips: 30, liquorSales: 100 }]);
  expect(result.value).toMatchObject({ id: 'cuidShift', employeeId: 'cuidEmployee', roleId: 'cuidRole', employee: { id: 'cuidEmployee', defaultRoleId: 'cuidRole' }, role: { id: 'cuidRole', configs: [{ id: 'uuidConfig', roleId: 'cuidRole' }] } });
  expect(callArgs(query, 'legacyApi:checkAccess')).toEqual([{ admin: false }]);
  expect(getToken).toHaveBeenCalledWith({ template: 'convex' }); expect(setAuth).toHaveBeenCalledWith('user-jwt');
});

test('native IDs for post-cutover records round-trip without name matching', async () => {
  responses['employees:get'] = { ...employee, id: 'employees:new', legacyId: undefined, defaultRoleId: null, defaultRole: null };
  const result = await request('employee', 'GET', undefined, '', 'employees:new');
  expect(result.status).toBe(200); expect(result.value.id).toBe('employees:new');
});

test('employees keep nested defaultRole Decimal string and public IDs without leaking native legacyId metadata', async () => {
  const result = await request('employees');
  expect(result.value[0]).toEqual({ ...employee, id: 'cuidEmployee', defaultRoleId: 'cuidRole', legacyId: undefined, defaultRole: { ...role, id: 'cuidRole', basePayRate: '9.5' } });
  expect(result.value[0]).not.toHaveProperty('legacyId');
  expect(result.headers.get('cache-control')).toBe('private, no-store');
});

test('role list exact select shape excludes timestamps and unused config fields', async () => {
  expect((await request('roles')).value).toEqual([{ id: 'cuidRole', name: 'Server', basePayRate: 9.5, configs: [{ id: 'uuidConfig', tipoutType: 'bar', percentageRate: 2.5, effectiveFrom: DATE, effectiveTo: null, paysTipout: true }] }]);
});

test('role GET returns current configs while config GET returns raw Decimal strings', async () => {
  expect((await request('role')).value.configs).toHaveLength(1);
  expect((await request('configs')).value[0]).toMatchObject({ id: 'uuidConfig', roleId: 'cuidRole', percentageRate: '2.5' });
});

test.each(['role', 'configs'] as const)('old advanced %s PUT is 409 before any write', async (resource) => {
  const result = await request(resource, 'PUT', { name: 'Changed' });
  expect(result.status).toBe(409); expect(result.value.error).toMatch(/Reload/); expect(mutation).not.toHaveBeenCalled();
});

test.each([undefined, 'https://tipout.example/roles/new/edit', 'https://elsewhere.example/roles'])('unsafe split new-role editor or absent referrer %s fails before POST', async (referer) => {
  expect((await request('roles', 'POST', { name: 'Server', basePayRate: 9.5 }, '', 'unused', referer ? { referer } : {})).status).toBe(409);
  expect(mutation).not.toHaveBeenCalled();
});

test('standalone role-list creation retains exact POST response and numeric parsing', async () => {
  const result = await request('roles', 'POST', { name: 'Server', basePayRate: '9.5' }, '', 'unused', { referer: 'https://tipout.example/roles' });
  expect(result.status).toBe(200); expect(result.value).toEqual({ id: 'cuidRole', name: 'Server', basePayRate: 9.5, configs: [] });
});

test('current configuration POST forwards all legacy flags and returns raw Decimal string', async () => {
  const result = await request('configurations', 'POST', { tipoutType: 'bar', percentageRate: '2.5', receivesTipout: true, paysTipout: false, distributionGroup: 'bar' });
  expect(callArgs(mutation, 'roleConfigs:setCurrent')).toEqual([{ roleId: role.id, tipoutType: 'bar', percentageRate: 2.5, receivesTipout: true, paysTipout: false, distributionGroup: 'bar' }]);
  expect(result.value.percentageRate).toBe('2.5');
});

test('report preserves totals, ignores employee input for pooling, and maps employee summary IDs', async () => {
  const result = await request('reports', 'GET', undefined, '?startDate=2026-10-01&endDate=2026-10-01&employeeId=cuidEmployee');
  expect(result.status).toBe(200); expect(result.value.employeeSummaries[0].employeeId).toBe('cuidEmployee');
  expect(callArgs(query, 'reports:get')).toEqual([{ startDate: '2026-10-01', endDate: '2026-10-01' }]);
});

test('shift list preserves employee/role filter, config overlap window and numeric values', async () => {
  const result = await request('shifts', 'GET', undefined, '?startDate=2026-10-01&endDate=2026-10-07&employeeId=cuidEmployee&role=Server');
  expect(result.status).toBe(200); expect(result.value[0].hours).toBe(8);
  expect(callArgs(query, 'shifts:list')).toEqual([{ startDate: '2026-10-01', endDate: '2026-10-07', employeeId: employee.id, role: 'Server' }]);
  expect(callArgs(query, 'legacyApi:configsForRoles')).toEqual([{ roleIds: [role.id], start: Date.parse(DATE), end: Date.parse('2026-10-07T23:59:59.999Z') }]);
});

test.each([
  ['employee', 'missing', 'Employee not found'], ['role', 'missing', 'Role not found'], ['shift', 'missing', 'Shift not found'],
] as const)('%s GET retains 404', async (resource, id, error) => {
  expect(await request(resource, 'GET', undefined, '', id)).toMatchObject({ status: 404, value: { error } });
});

test('unknown employee filter and unknown role config GET preserve empty arrays', async () => {
  expect((await request('shifts', 'GET', undefined, '?employeeId=missing')).value).toEqual([]);
  expect((await request('configs', 'GET', undefined, '', 'missing')).value).toEqual([]);
});

test.each([
  ['employees', 'POST', {}, '', 'Name is required'],
  ['shifts', 'POST', {}, '', 'Missing required fields'],
  ['shift', 'PUT', {}, '', 'Missing required fields'],
  ['configurations', 'POST', {}, '', 'Tipout type and percentage rate are required'],
  ['configurations', 'DELETE', undefined, '', 'Tipout type is required'],
] as const)('%s %s retains required-field 400', async (resource, method, body, suffix, error) => {
  expect(await request(resource, method, body, suffix, 'missing')).toMatchObject({ status: 400, value: { error } });
});

test('report retains message envelope on missing dates and backend failure', async () => {
  expect(await request('reports')).toMatchObject({ status: 400, value: { message: 'Missing required date parameters (startDate, endDate)' } });
  query.mockRejectedValueOnce(new Error('secret backend error'));
  expect(await request('reports')).toMatchObject({ status: 500, value: { message: 'Error generating report data' } });
});

test('missing JWT returns 503 without exposing data or attempting service credentials', async () => {
  getToken.mockResolvedValue(null);
  expect((await request('employees')).status).toBe(503); expect(query).not.toHaveBeenCalled(); expect(mutation).not.toHaveBeenCalled();
});

test('invalid financial/date inputs fail before writes with legacy 500 envelope', async () => {
  expect((await request('shifts', 'POST', { employeeId: 'cuidEmployee', roleId: 'cuidRole', date: 'not-a-date', hours: '8' })).status).toBe(500);
  expect((await request('shifts', 'POST', { employeeId: 'cuidEmployee', roleId: 'cuidRole', date: '2026-10-01', hours: 'NaN' })).status).toBe(500);
  expect(mutation).not.toHaveBeenCalled();
});

test('ID mapping is field-aware and fails closed on missing identity', () => {
  const input = { id: role.id, name: role.id, configs: [config] };
  const refs = collectIdReferences(input, 'roles');
  expect(refs).toEqual([{ table: 'roles', id: role.id }, { table: 'roleConfigs', id: config.id }]);
  const mappings = refs.map((ref) => ({ ...ref, input: ref.id, publicId: ids.find((row) => row.id === ref.id)!.publicId }));
  expect(serializeLegacyIds(input, mappings, 'roles')).toMatchObject({ id: 'cuidRole', name: role.id });
  expect(() => serializeLegacyIds(input, [], 'roles')).toThrow('Unresolved response identity');
});

test.each([
  ['employees', '', 'unused'], ['employee', '', 'cuidEmployee'],
  ['roles', '', 'unused'], ['role', '', 'cuidRole'], ['configs', '', 'cuidRole'], ['configurations', '', 'cuidRole'],
  ['shifts', '', 'unused'], ['shift', '', 'cuidShift'], ['reports', '?startDate=2026-10-01&endDate=2026-10-01', 'unused'], ['groups', '', 'unused'],
] as const)('staff retains %s GET', async (resource, suffix, id) => {
  isAdmin = false;
  expect((await request(resource, 'GET', undefined, suffix, id)).status).toBe(200);
  expect(callArgs(query, 'legacyApi:checkAccess')).toEqual([{ admin: false }]);
});

test.each([
  ['employee', 'DELETE', 'cuidEmployee', '', 'employees:remove'],
  ['role', 'DELETE', 'cuidRole', '', 'roles:remove'],
  ['shift', 'DELETE', 'cuidShift', '', 'shifts:remove'],
  ['configurations', 'DELETE', 'cuidRole', '?tipoutType=bar', 'roleConfigs:endCurrent'],
] as const)('admin retains %s %s success contract', async (resource, method, id, suffix, mutationName) => {
  expect(await request(resource, method, undefined, suffix, id)).toMatchObject({ status: 200, value: { success: true } });
  expect(callArgs(mutation, mutationName)).toHaveLength(1);
});

test('admin employee update resolves default role and preserves explicit null clearing', async () => {
  expect((await request('employee', 'PUT', { name: 'Changed', active: false, defaultRoleId: 'cuidRole' }, '', 'cuidEmployee')).status).toBe(200);
  expect(callArgs(mutation, 'employees:update')[0]).toEqual({ id: employee.id, name: 'Changed', active: false, defaultRoleId: role.id });
  await request('employee', 'PUT', { defaultRoleId: null }, '', 'cuidEmployee');
  expect(callArgs(mutation, 'employees:update')[1]).toEqual({ id: employee.id, defaultRoleId: null });
});

test('admin role PATCH and shift PUT preserve partial/full update contracts', async () => {
  expect((await request('role', 'PATCH', { basePayRate: '12.50' })).status).toBe(200);
  expect(callArgs(mutation, 'roles:update')[0]).toEqual({ id: role.id, basePayRate: 12.5 });
  const input = { employeeId: 'cuidEmployee', roleId: 'cuidRole', date: DATE, hours: 8 };
  expect((await request('shift', 'PUT', input, '', 'cuidShift')).status).toBe(200);
  expect(callArgs(mutation, 'shifts:update')[0]).toEqual({ id: shift.id, employeeId: employee.id, roleId: role.id, date: DATE, hours: 8, cashTips: 0, creditTips: 0, liquorSales: 0 });
});

test('a post-mutation projection failure is an ambiguous 500 and does not auto-retry a committed create', async () => {
  const implementation = query.getMockImplementation()!;
  query.mockImplementation(async (ref, args) => {
    if (getFunctionName(ref) === 'legacyApi:configsForRoles') throw new Error('projection unavailable');
    return implementation(ref, args);
  });
  const result = await request('shifts', 'POST', { employeeId: 'cuidEmployee', roleId: 'cuidRole', date: '2026-10-01', hours: 8 });
  expect(result).toMatchObject({ status: 500, value: { error: 'Failed to create shift' } });
  expect(callArgs(mutation, 'shifts:create')).toHaveLength(1);
});
