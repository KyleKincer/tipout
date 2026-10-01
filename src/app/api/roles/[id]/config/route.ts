import { handleLegacyApi, type LegacyRouteContext } from '@/lib/legacyApi';

export const dynamic = 'force-dynamic';

export function GET(request: Request, context: LegacyRouteContext) {
  return handleLegacyApi('configs', request, context);
}
export function PUT(request: Request, context: LegacyRouteContext) {
  return handleLegacyApi('configs', request, context);
}
