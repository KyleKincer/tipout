import { handleLegacyApi, type LegacyRouteContext } from '@/lib/legacyApi';

export const dynamic = 'force-dynamic';

export function GET(request: Request, context: LegacyRouteContext) {
  return handleLegacyApi('configurations', request, context);
}
export function POST(request: Request, context: LegacyRouteContext) {
  return handleLegacyApi('configurations', request, context);
}
export function DELETE(request: Request, context: LegacyRouteContext) {
  return handleLegacyApi('configurations', request, context);
}
