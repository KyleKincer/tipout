import { FRONTEND_BACKEND_CONTRACT } from '../../convex/lib/deploymentContract';
import { requireBackendCheck, verifyBackendContract } from '../lib/backend-compatibility';

test('all ordinary builds require the contract check, with a local-only offline opt-in', () => {
  expect(requireBackendCheck({})).toBe(true);
  expect(requireBackendCheck({ TIPOUT_OFFLINE_BUILD: '1' })).toBe(false);
  for (const hosted of [{ VERCEL: '1' }, { VERCEL_ENV: 'production' }, { CI: 'true' }]) {
    expect(() => requireBackendCheck({ ...hosted, TIPOUT_OFFLINE_BUILD: '1' })).toThrow('forbidden');
  }
});

test('missing, malformed, absent and old backends fail closed', async () => {
  const read = jest.fn(async () => ({ contract: 'old' }));
  await expect(verifyBackendContract({}, read)).rejects.toThrow('NEXT_PUBLIC_CONVEX_URL');
  await expect(verifyBackendContract({ NEXT_PUBLIC_CONVEX_URL: 'https://user:secret@example.com' }, read)).rejects.toThrow('HTTPS origin');
  expect(read).not.toHaveBeenCalled();
  await expect(verifyBackendContract({ NEXT_PUBLIC_CONVEX_URL: 'https://example.convex.cloud' }, read)).rejects.toThrow('required frontend contract');
  await expect(verifyBackendContract({ NEXT_PUBLIC_CONVEX_URL: 'https://example.convex.cloud' }, async () => { throw new Error('Unavailable'); }))
    .rejects.toThrow('Unavailable');
});

test('matching metadata-only contract enables a frontend build', async () => {
  const read = jest.fn(async () => ({ contract: FRONTEND_BACKEND_CONTRACT }));
  await expect(verifyBackendContract({ NEXT_PUBLIC_CONVEX_URL: 'https://example.convex.cloud/' }, read)).resolves.toBeUndefined();
  expect(read).toHaveBeenCalledWith('https://example.convex.cloud');
});

test('local offline build performs no backend request', async () => {
  const read = jest.fn();
  await verifyBackendContract({ TIPOUT_OFFLINE_BUILD: '1' }, read);
  expect(read).not.toHaveBeenCalled();
});
