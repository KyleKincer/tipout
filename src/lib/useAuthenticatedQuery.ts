"use client";

import { useConvexAuth, useQuery } from "convex/react";
import type { OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";

// Clerk's browser session can be ready before its Convex JWT is accepted.
// Defer protected reads until Convex confirms authentication.
export function useAuthenticatedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): FunctionReturnType<Query> | undefined {
  const { isAuthenticated } = useConvexAuth();
  const authenticatedArgs = isAuthenticated ? args : ["skip"];
  return useQuery(query, ...(authenticatedArgs as OptionalRestArgsOrSkip<Query>));
}
