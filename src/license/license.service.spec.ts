import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { LicenseService } from './license.service';

describe('License configuration and device binding', () => {
  it.each([undefined, '', '   ', 'hairtech_offline_license_secret_key_32bytes_min!'])('refuses a missing/default signing key', (key) => {
    expect(() => new LicenseService({} as SupabaseService, new ConfigService({ LICENSE_SIGNING_KEY: key }))).toThrow('LICENSE_SIGNING_KEY');
  });

  it('rejects a fingerprint that does not match the session device', async () => {
    const chain: Record<string, jest.Mock> = {};
    for (const name of ['update', 'eq', 'select']) chain[name] = jest.fn(() => chain);
    chain.maybeSingle = jest.fn()
      .mockResolvedValueOnce({ data: { id: 'session', device_id: 'device' } })
      .mockResolvedValueOnce({ data: null });
    const supabase = { getAdminClient: () => ({ from: () => chain }) };
    const service = new LicenseService(supabase as unknown as SupabaseService, new ConfigService({ LICENSE_SIGNING_KEY: 'test-only-key' }));
    await expect(service.processHeartbeat('user', 'session-hash', 'wrong-machine')).rejects.toThrow('không khớp');
  });
});
