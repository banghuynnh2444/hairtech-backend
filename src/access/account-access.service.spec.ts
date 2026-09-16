import { ConfigService } from '@nestjs/config';
import { AccountAccessService } from './account-access.service';
import { SupabaseService } from '../supabase/supabase.service';
import { requiredJwtSecret } from '../auth/jwt-config';
import { LicenseGuard } from '../license/guards/license.guard';

it.each([undefined,'','  ','default_secret'])('fails startup for missing/default JWT key: %s', key => {
  expect(() => requiredJwtSecret(new ConfigService({ JWT_SECRET: key }))).toThrow('JWT_SECRET');
});
it('uses the same account/device/session checks on protected APIs', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: '2030-01-01T00:00:00Z' });
  const access = new AccountAccessService({ getAdminClient: () => ({ rpc }) } as unknown as SupabaseService);
  const guard = new LicenseGuard(access);
  await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u', sessionTokenHash: 'h', deviceId: 'd' } }) }) } as never)).resolves.toBe(true);
  expect(rpc).toHaveBeenCalledWith('verify_account_session', { p_user_id: 'u', p_session_hash: 'h', p_device_id: 'd', p_fingerprint: null, p_touch: false });
});
it.each(['ACCOUNT_NOT_APPROVED','PAID_PLAN_REQUIRED','SUBSCRIPTION_EXPIRED','DEVICE_NOT_ACTIVE','SESSION_TERMINATED'])('blocks protected access on %s', async message => {
  const access = new AccountAccessService({ getAdminClient: () => ({ rpc: async () => ({ error: { message } }) }) } as unknown as SupabaseService);
  await expect(access.verify('u','h','d')).rejects.toMatchObject({ response: { code: message } });
});
