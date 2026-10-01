import { auth } from '@clerk/nextjs/server';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import {
  collectIdReferences, currentRole, rawConfigs, rawEmployee, roleList, serializeLegacyIds,
  type IdReference, type JsonRecord, type LegacyTable, type ResolvedReference,
} from './legacyApiContract';

type Resource = 'employees' | 'employee' | 'roles' | 'role' | 'configs' | 'configurations' | 'shifts' | 'shift' | 'reports' | 'groups';
export type LegacyRouteContext = { params: Promise<{ id: string }> };
const RELOAD = 'This role editor is out of date. Reload the page before saving; no changes were saved by this request.';
class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function reply(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
}
function finiteNumber(value: unknown, parse = false): number {
  const number = parse ? parseFloat(String(value)) : Number(value);
  if (!Number.isFinite(number)) throw new Error('Invalid numeric value');
  return number;
}
function dateBoundary(value: string, end = false): number {
  const parsed = Date.parse(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (!Number.isFinite(parsed)) throw new Error('Invalid date');
  return parsed;
}
function errorLabel(resource: Resource, method: string): { key: 'error' | 'message'; text: string } {
  if (resource === 'reports') return { key: 'message', text: 'Error generating report data' };
  if (resource === 'groups') return { key: 'message', text: 'Error fetching tip pool groups' };
  const noun = { employees: 'employees', employee: 'employee', roles: 'roles', role: 'role', configs: 'role configs', configurations: 'role configurations', shifts: 'shifts', shift: 'shift' }[resource];
  const singular = { employees: 'employee', roles: 'role', shifts: 'shift', configurations: 'role configuration' }[resource as 'employees' | 'roles' | 'shifts' | 'configurations'] ?? noun;
  const action = method === 'GET' ? 'fetch' : method === 'POST' ? 'create' : method === 'DELETE' ? (resource === 'configurations' ? 'remove' : 'delete') : 'update';
  return { key: 'error', text: `Failed to ${action} ${method === 'GET' ? noun : singular}` };
}

/** Every HTTP request uses its signed-in Clerk user's JWT, never a deploy key.
 * Convex remains the authoritative authorization boundary for every operation. */
async function connect(write: boolean, staffCreate: boolean) {
  const session = await auth();
  if (!session.userId) throw new ApiError(401, 'Not authenticated');
  const token = await session.getToken({ template: 'convex' });
  if (!token) throw new ApiError(503, 'Authentication is temporarily unavailable. Please reload and try again.');
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new ApiError(503, 'Service temporarily unavailable');
  const client = new ConvexHttpClient(url, { logger: false });
  client.setAuth(token);
  const query = (name: string, args: JsonRecord = {}) => client.query(makeFunctionReference<'query'>(name), args);
  const mutation = (name: string, args: JsonRecord) => client.mutation(makeFunctionReference<'mutation'>(name), args);
  await query('legacyApi:checkAccess', { admin: write && !staffCreate });
  async function resolve(refs: IdReference[]): Promise<ResolvedReference[]> {
    const rows: ResolvedReference[] = [];
    for (let start = 0; start < refs.length; start += 256) {
      rows.push(...await query('legacyApi:resolveIds', { refs: refs.slice(start, start + 256) }));
    }
    return rows;
  }
  async function native(table: LegacyTable, id: unknown, missingStatus = 500): Promise<string> {
    if (typeof id !== 'string' || !id) throw new ApiError(missingStatus, `${table === 'employees' ? 'Employee' : table === 'roles' ? 'Role' : 'Shift'} not found`);
    const row = (await resolve([{ table, id }]))[0];
    if (!row?.id) throw new ApiError(missingStatus, `${table === 'employees' ? 'Employee' : table === 'roles' ? 'Role' : 'Shift'} not found`);
    return row.id;
  }
  async function legacy(value: unknown, table?: LegacyTable) {
    return serializeLegacyIds(value, await resolve(collectIdReferences(value, table)), table);
  }
  async function shiftWindow(value: unknown, start: number, end: number) {
    const rows = (Array.isArray(value) ? value : [value]) as JsonRecord[];
    const roleIds = [...new Set(rows.map((row) => String(row.roleId)))];
    const configs = new Map<string, unknown>();
    for (let offset = 0; offset < roleIds.length; offset += 256) {
      const results = await query('legacyApi:configsForRoles', { roleIds: roleIds.slice(offset, offset + 256), start, end });
      for (const item of results) configs.set(item.roleId, item.configs);
    }
    const result = rows.map((row) => ({ ...row, role: { ...(row.role as JsonRecord), configs: configs.get(String(row.roleId)) ?? [] } }));
    return Array.isArray(value) ? result : result[0];
  }
  return { query, mutation, native, legacy, shiftWindow };
}

export async function handleLegacyApi(resource: Resource, request: Request, context?: LegacyRouteContext): Promise<Response> {
  const method = request.method;
  const error = errorLabel(resource, method);
  try {
    const service = await connect(method !== 'GET', resource === 'shifts' && method === 'POST');
    const { query, mutation, native, legacy, shiftWindow } = service;
    const id = context ? (await context.params).id : undefined;
    const search = new URL(request.url).searchParams;
    const body = async (): Promise<JsonRecord> => {
      const value = await request.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON body');
      return value;
    };

    if (resource === 'employees') {
      if (method === 'GET') return reply(rawEmployee(await legacy(await query('employees:list'), 'employees')));
      const data = await body();
      if (!data.name) throw new ApiError(400, 'Name is required');
      return reply(rawEmployee(await legacy(await mutation('employees:create', { name: data.name }), 'employees')));
    }
    if (resource === 'employee') {
      const employeeId = await native('employees', id, method === 'GET' ? 404 : 500);
      if (method === 'DELETE') return reply(await mutation('employees:remove', { id: employeeId }));
      if (method === 'GET') {
        const employee = await query('employees:get', { id: employeeId });
        if (!employee) throw new ApiError(404, 'Employee not found');
        return reply(rawEmployee(await legacy(employee, 'employees')));
      }
      const data = await body();
      const args: JsonRecord = { id: employeeId };
      for (const key of ['name', 'active']) if (data[key] !== undefined) args[key] = data[key];
      if (data.defaultRoleId !== undefined) args.defaultRoleId = data.defaultRoleId === null ? null : await native('roles', data.defaultRoleId);
      return reply(rawEmployee(await legacy(await mutation('employees:update', args), 'employees')));
    }
    if (resource === 'roles') {
      if (method === 'GET') return reply(roleList(await legacy(await query('roles:list'), 'roles')));
      // A legacy advanced NEW editor performs POST then a separate config PUT.
      // Only the known standalone role-list creation flow is safe. Missing or
      // unfamiliar referrers fail closed before the first write, rather than
      // create a role that the following stale configuration request cannot save.
      const referer = request.headers.get('referer');
      const origin = new URL(request.url).origin;
      if (!referer || new URL(referer).origin !== origin || !/^\/roles\/?$/.test(new URL(referer).pathname)) throw new ApiError(409, RELOAD);
      const data = await body();
      if (!data.name || data.basePayRate === undefined) throw new ApiError(400, 'Name and base pay rate are required');
      const role = await legacy(await mutation('roles:create', { name: data.name, basePayRate: finiteNumber(data.basePayRate, true) }), 'roles') as JsonRecord;
      return reply({ id: role.id, name: role.name, basePayRate: role.basePayRate, configs: role.configs });
    }
    if (resource === 'role') {
      // Do not manufacture a fresh revision for a stale two-request editor.
      // Blocking the first write avoids partially saved role fields/configs.
      if (method === 'PUT') throw new ApiError(409, RELOAD);
      const roleId = await native('roles', id, method === 'GET' ? 404 : 500);
      if (method === 'DELETE') return reply(await mutation('roles:remove', { id: roleId }));
      if (method === 'GET') {
        const role = await query('roles:get', { id: roleId });
        if (!role) throw new ApiError(404, 'Role not found');
        return reply(currentRole(await legacy(role, 'roles')));
      }
      const data = await body();
      const args: JsonRecord = { id: roleId };
      if (data.name) args.name = data.name;
      if (data.basePayRate !== undefined) args.basePayRate = finiteNumber(data.basePayRate, true);
      return reply(currentRole(await legacy(await mutation('roles:update', args), 'roles')));
    }
    if (resource === 'configs' || resource === 'configurations') {
      if (resource === 'configs' && method === 'PUT') throw new ApiError(409, RELOAD);
      const data = method === 'POST' ? await body() : undefined;
      const tipoutType = search.get('tipoutType');
      if (method === 'DELETE' && !tipoutType) throw new ApiError(400, 'Tipout type is required');
      if (data && (!data.tipoutType || data.percentageRate === undefined)) throw new ApiError(400, 'Tipout type and percentage rate are required');
      let roleId: string;
      try { roleId = await native('roles', id, method === 'POST' ? 500 : 404); }
      catch (err) {
        if (err instanceof ApiError && err.status === 404 && method === 'GET') return reply([]);
        if (err instanceof ApiError && err.status === 404 && method === 'DELETE' && search.get('tipoutType')) return reply({ success: true });
        throw err;
      }
      if (method === 'GET') {
        const configs = await query(resource === 'configs' ? 'roleConfigs:listForRole' : 'roleConfigs:listCurrentForRole', { roleId });
        return reply(rawConfigs(await legacy(configs, 'roleConfigs')));
      }
      if (method === 'DELETE') {
        return reply(await mutation('roleConfigs:endCurrent', { roleId, tipoutType }));
      }
      const args: JsonRecord = { roleId, tipoutType: data!.tipoutType, percentageRate: finiteNumber(data!.percentageRate, true) };
      for (const key of ['receivesTipout', 'paysTipout', 'distributionGroup']) if (data![key] !== undefined) args[key] = data![key];
      return reply(rawConfigs([await legacy(await mutation('roleConfigs:setCurrent', args), 'roleConfigs')])[0]);
    }
    if (resource === 'shifts' && method === 'GET') {
      const args: JsonRecord = {};
      for (const key of ['startDate', 'endDate', 'role']) if (search.get(key)) args[key] = search.get(key);
      if (search.get('employeeId')) {
        try { args.employeeId = await native('employees', search.get('employeeId'), 404); }
        catch (err) { if (err instanceof ApiError && err.status === 404) return reply([]); throw err; }
      }
      const today = new Date().toISOString().split('T')[0];
      const start = String(args.startDate ?? today);
      const end = String(args.endDate ?? args.startDate ?? today);
      const shifts = await shiftWindow(await query('shifts:list', args), dateBoundary(start), dateBoundary(end, true));
      return reply(await legacy(shifts, 'shifts'));
    }
    if (resource === 'shift' || resource === 'shifts') {
      const data = method === 'POST' || method === 'PUT' ? await body() : undefined;
      if (data && (!data.employeeId || !data.roleId || !data.date || data.hours === undefined)) throw new ApiError(400, 'Missing required fields');
      const shiftId = resource === 'shift' ? await native('shifts', id, method === 'GET' ? 404 : 500) : undefined;
      if (method === 'DELETE') return reply(await mutation('shifts:remove', { id: shiftId }));
      if (method === 'GET') {
        const shift = await query('shifts:get', { id: shiftId });
        if (!shift) throw new ApiError(404, 'Shift not found');
        return reply(await legacy(shift, 'shifts'));
      }

      if (!data) throw new Error('Missing shift data');
      const args: JsonRecord = {
        employeeId: await native('employees', data.employeeId), roleId: await native('roles', data.roleId),
        date: data.date, hours: finiteNumber(data.hours), cashTips: finiteNumber(data.cashTips || 0),
        creditTips: finiteNumber(data.creditTips || 0), liquorSales: finiteNumber(data.liquorSales || 0),
      };
      if (shiftId) args.id = shiftId;
      // Validate legacy POST's bare-day contract before a mutation can commit.
      const start = method === 'POST' ? dateBoundary(String(data.date)) : undefined;
      const end = method === 'POST' ? dateBoundary(String(data.date), true) : undefined;
      const created = await mutation(method === 'POST' ? 'shifts:create' : 'shifts:update', args);
      const shift = method === 'POST' ? await shiftWindow(created, start!, end!) : created;
      return reply(await legacy(shift, 'shifts'));
    }
    if (resource === 'reports') {
      const startDate = search.get('startDate');
      const endDate = search.get('endDate');
      if (!startDate || !endDate) throw new ApiError(400, 'Missing required date parameters (startDate, endDate)');
      dateBoundary(startDate); dateBoundary(endDate, true);
      // Legacy employeeId is an optional presentation filter, never a pooling input.
      return reply(await legacy(await query('reports:get', { startDate, endDate })));
    }
    if (resource === 'groups') return reply(await query('tipPoolGroups:list'));
    return reply({ error: 'Method not allowed' }, 405);
  } catch (err) {
    if (err instanceof ApiError && err.status !== 500) return reply({ [error.key]: err.message }, err.status);
    const data = err instanceof ConvexError ? err.data : undefined;
    if (data === 'Not authenticated') return reply({ [error.key]: 'Not authenticated' }, 401);
    if (data === 'Admin required') return reply({ [error.key]: 'Admin required' }, 403);
    // Never expose JWTs, private payroll payloads, or Convex internals to clients/logs.
    return reply({ [error.key]: error.text }, 500);
  }
}
