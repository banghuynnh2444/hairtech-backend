import { ConfigService } from '@nestjs/config';
import { SupabaseService } from './supabase.service';

const jwt = (payload: object) => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify(payload)).toString('base64url'), 'test-signature',
].join('.');

describe('Supabase service client isolation', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });
  const configure = (key: string) => new ConfigService({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: key });

  it.each(['sb_publishable_test', jwt({ role: 'anon' }), 'not-a-key', ''])('rejects a non-service key without revealing it', (key) => {
    expect(() => new SupabaseService(configure(key))).toThrow();
    if (key) {
      try { new SupabaseService(configure(key)); } catch (e) { expect((e as Error).message).not.toContain(key); }
    }
  });

  it.each(['sb_secret_test', jwt({ role: 'service_role' })])('retains service credentials after separate concurrent logins (%s)', async (key) => {
    const requests: { url: string; headers: Headers }[] = [];
    const userToken = jwt({ sub: 'user-id', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
    globalThis.fetch = jest.fn(async (input, init) => {
      const url = String(input);
      requests.push({ url, headers: new Headers(init?.headers) });
      const data = url.includes('/auth/v1/token')
        ? { access_token: userToken, refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer', user: { id: 'user-id' } }
        : [];
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const service = new SupabaseService(configure(key));
    const first = service.createAuthClient();
    const second = service.createAuthClient();
    expect(first).not.toBe(second);
    await Promise.all([first, second].map(client => client.auth.signInWithPassword({ email: 'test@example.invalid', password: 'fake-password' })));
    await service.getAdminClient().from('active_sessions').select('id');
    const database = requests.find(request => request.url.includes('/rest/v1/active_sessions'))!;
    expect(database.headers.get('apikey')).toBe(key);
    expect(database.headers.get('Authorization')).toBe('Bearer ' + key);
    expect(database.headers.get('Authorization')).not.toBe('Bearer ' + userToken);
    expect(() => service.getAdminClient().auth.signInWithPassword).toThrow();
  });
});
