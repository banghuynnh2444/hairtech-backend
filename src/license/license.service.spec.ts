import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { AccountAccessService } from '../access/account-access.service';
import { LicenseService } from './license.service';

const pair = crypto.generateKeyPairSync('ed25519');
const privateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url');

function createService(access: Partial<AccountAccessService>) {
  return new LicenseService(
    new ConfigService({ LICENSE_PRIVATE_KEY: privateKey }),
    access as AccountAccessService,
  );
}

describe('Ed25519 offline license', () => {
  it.each([undefined, '', '   '])('rejects a missing private key: %s', key => {
    expect(() => new LicenseService(new ConfigService({ LICENSE_PRIVATE_KEY: key }), {} as AccountAccessService))
      .toThrow('LICENSE_PRIVATE_KEY');
  });
  it('rejects a non-Ed25519 private key', () => {
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
      .export({ format: 'der', type: 'pkcs8' }).toString('base64url');
    expect(() => new LicenseService(new ConfigService({ LICENSE_PRIVATE_KEY: rsa }), {} as AccountAccessService))
      .toThrow('Ed25519');
  });
  it('does not issue a license for an ineligible account or device', async () => {
    const access = { verify: jest.fn().mockRejectedValue(new Error('blocked')) };
    const service = createService(access);
    await expect(service.processHeartbeat('u', 'h', 'fp', 'd')).rejects.toThrow('blocked');
    expect(access.verify).toHaveBeenCalledWith('u', 'h', 'd', 'fp', true);
  });
  it('signs identity, device and expiry with Ed25519', async () => {
    const expiry = new Date(Date.now() + 3600000).toISOString();
    const access = { verify: jest.fn().mockResolvedValue(expiry) };
    const service = createService(access);
    const result = await service.processHeartbeat('u', 'h', 'fp', 'd');
    const [encodedPayload, encodedSignature] = result.offlineLicense.split('.');
    const serialized = Buffer.from(encodedPayload, 'base64url');
    const payload = JSON.parse(serialized.toString());

    expect(crypto.verify(null, serialized, pair.publicKey, Buffer.from(encodedSignature, 'base64url'))).toBe(true);
    expect(payload).toMatchObject({ version: 1, sub: 'u', deviceId: 'd', fp: 'fp' });
    expect(payload.validUntil).toBe(result.expiresAt);
    expect(payload.validUntil).toBeLessThanOrEqual(payload.issuedAt + 72 * 3600);
    expect(payload.validUntil).toBeLessThanOrEqual(payload.subscriptionExpiresAt);
    expect(result.expiresAt).toBe(Math.floor(Date.parse(expiry) / 1000));
  });
  it('never grants more than 72 hours offline when the subscription lasts longer', async () => {
    const expiry = new Date(Date.now() + 10 * 24 * 3600000).toISOString();
    const service = createService({ verify: jest.fn().mockResolvedValue(expiry) });
    const result = await service.processHeartbeat('u', 'h', 'fp', 'd');
    const payload = JSON.parse(Buffer.from(result.offlineLicense.split('.')[0], 'base64url').toString());
    expect(payload.validUntil).toBe(payload.issuedAt + 72 * 3600);
  });
});
