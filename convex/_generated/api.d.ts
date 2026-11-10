/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as audit from "../audit.js";
import type * as deployment from "../deployment.js";
import type * as employees from "../employees.js";
import type * as etl from "../etl.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_data from "../lib/data.js";
import type * as lib_deploymentContract from "../lib/deploymentContract.js";
import type * as lib_reports from "../lib/reports.js";
import type * as payPeriods from "../payPeriods.js";
import type * as reports from "../reports.js";
import type * as roles from "../roles.js";
import type * as shifts from "../shifts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  audit: typeof audit;
  deployment: typeof deployment;
  employees: typeof employees;
  etl: typeof etl;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/data": typeof lib_data;
  "lib/deploymentContract": typeof lib_deploymentContract;
  "lib/reports": typeof lib_reports;
  payPeriods: typeof payPeriods;
  reports: typeof reports;
  roles: typeof roles;
  shifts: typeof shifts;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
