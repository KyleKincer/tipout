import type { Doc } from "../_generated/dataModel";

export function serializeEmployee(
  doc: Doc<"employees">,
  defaultRole?: Doc<"roles"> | null,
) {
  return {
    id: doc._id,
    name: doc.name,
    active: doc.active,
    defaultRoleId: doc.defaultRoleId ?? null,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
    defaultRole: defaultRole ? serializeRoleBare(defaultRole) : null,
  };
}

export function serializeRoleBare(doc: Doc<"roles">) {
  return {
    id: doc._id,
    name: doc.name,
    basePayRate: doc.basePayRate,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

export function serializeRoleConfig(doc: Doc<"roleConfigs">) {
  return {
    id: doc._id,
    roleId: doc.roleId,
    tipoutType: doc.tipoutType,
    percentageRate: doc.percentageRate,
    effectiveFrom: new Date(doc.effectiveFrom).toISOString(),
    effectiveTo: doc.effectiveTo ? new Date(doc.effectiveTo).toISOString() : null,
    receivesTipout: doc.receivesTipout,
    paysTipout: doc.paysTipout,
    distributionGroup: doc.distributionGroup ?? null,
    tipPoolGroup: doc.tipPoolGroup ?? null,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

export function serializeRoleWithConfigs(
  doc: Doc<"roles">,
  configs: Doc<"roleConfigs">[],
) {
  return {
    ...serializeRoleBare(doc),
    configs: configs.map(serializeRoleConfig),
  };
}

export function serializeShift(
  doc: Doc<"shifts">,
  employee: Doc<"employees">,
  role: Doc<"roles">,
  roleConfigs: Doc<"roleConfigs">[],
) {
  return {
    id: doc._id,
    employeeId: doc.employeeId,
    roleId: doc.roleId,
    date: new Date(doc.date).toISOString(),
    hours: doc.hours,
    cashTips: doc.cashTips,
    creditTips: doc.creditTips,
    liquorSales: doc.liquorSales,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
    employee: {
      id: employee._id,
      name: employee.name,
      active: employee.active,
      defaultRoleId: employee.defaultRoleId ?? null,
      createdAt: new Date(employee.createdAt).toISOString(),
      updatedAt: new Date(employee.updatedAt).toISOString(),
    },
    role: serializeRoleWithConfigs(role, roleConfigs),
  };
}

// Parse YYYY-MM-DD or full ISO strings to UTC ms. Mirrors today's behaviour:
// bare YYYY-MM-DD becomes UTC midnight; full ISO strings are parsed verbatim.
export function parseDateInput(input: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return Date.parse(`${input}T00:00:00.000Z`);
  }
  return Date.parse(input);
}

export function parseEndOfDay(input: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return Date.parse(`${input}T23:59:59.999Z`);
  }
  return Date.parse(input);
}
