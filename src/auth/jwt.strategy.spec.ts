import { ConfigService } from '@nestjs/config';
import { JwtPayload, JwtStrategy } from './jwt.strategy';

describe('JWT token type boundary', () => {
  const payload = {
    sub: 'user', email: 'user@example.invalid', deviceId: 'device',
    sessionTokenHash: 'hash', tokenType: 'access',
  } satisfies JwtPayload;

  it('accepts access tokens', async () => {
    const strategy = new JwtStrategy(new ConfigService({ JWT_SECRET: 'test-secret' }));
    await expect(strategy.validate(payload)).resolves.toEqual(payload);
  });

  it('rejects refresh tokens on protected API routes', async () => {
    const strategy = new JwtStrategy(new ConfigService({ JWT_SECRET: 'test-secret' }));
    await expect(strategy.validate({ ...payload, tokenType: 'refresh' })).rejects.toMatchObject({ status: 401 });
  });
});
