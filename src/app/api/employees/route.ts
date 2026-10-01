import { handleLegacyApi } from '@/lib/legacyApi';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return handleLegacyApi('employees', request);
}
export function POST(request: Request) {
  return handleLegacyApi('employees', request);
}
