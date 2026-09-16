import { ConfigService } from '@nestjs/config';
import { AccountAccessService } from '../access/account-access.service';
import { LicenseService } from './license.service';

describe('License eligibility integration (signature format unchanged)', () => {
  it.each([undefined,'','   ','hairtech_offline_license_secret_key_32bytes_min!'])('rejects missing/default key %s', key => {
    expect(() => new LicenseService(new ConfigService({ LICENSE_SIGNING_KEY: key }), {} as AccountAccessService)).toThrow('LICENSE_SIGNING_KEY');
  });
  it('does not issue a license for an ineligible account or device', async () => {
    const access = { verify: jest.fn().mockRejectedValue(new Error('blocked')) };
    const service = new LicenseService(new ConfigService({ LICENSE_SIGNING_KEY: 'test-only-key' }), access as unknown as AccountAccessService);
    await expect(service.processHeartbeat('u','h','fp','d')).rejects.toThrow('blocked');
    expect(access.verify).toHaveBeenCalledWith('u','h','d','fp',true);
  });
  it('never extends the signed expiry past the paid subscription', async () => {
    const expiry = new Date(Date.now() + 3600000).toISOString();
    const access = { verify: jest.fn().mockResolvedValue(expiry) };
    const service = new LicenseService(new ConfigService({ LICENSE_SIGNING_KEY: 'test-only-key' }), access as unknown as AccountAccessService);
    const result = await service.processHeartbeat('u','h','fp','d');
    expect(result.expiresAt).toBe(Math.floor(Date.parse(expiry)/1000));
    const payload = JSON.parse(Buffer.from(result.offlineLicense.split('.')[0], 'base64url').toString());
    expect(payload.fp).toBe('fp'); expect(payload.validUntil).toBe(result.expiresAt);
  });
});
