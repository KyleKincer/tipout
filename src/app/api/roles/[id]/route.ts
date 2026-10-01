import { handleLegacyApi, type LegacyRouteContext } from '@/lib/legacyApi';

export const dynamic = 'force-dynamic';

export function GET(request: Request, context: LegacyRouteContext) {
  return handleLegacyApi('role', request, context);
}
export function PUT(request: Request, context: LegacyRouteContext) {
  return handleLegacyApi('role', request, context);
}
export function PATCH(request: Request, context: LegacyRouteContext) {
  return handleLegacyApi('role', request, context);
}
export function DELETE(request: Request, context: LegacyRouteContext) {
  return handleLegacyApi('role', request, context);
}
