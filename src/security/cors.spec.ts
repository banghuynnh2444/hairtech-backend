import { resolveCorsOrigins } from './cors';

describe('CORS origin configuration', () => {
  it('always allows the desktop and Vite development origins', () => {
    const origins = resolveCorsOrigins();
    expect(origins).toContain('http://tauri.localhost');
    expect(origins).toContain('http://localhost:1420');
  });

  it('normalizes explicit HTTPS origins', () => {
    const origins = resolveCorsOrigins('https://app.example.test/, https://admin.example.test');
    expect(origins).toContain('https://app.example.test');
    expect(origins).toContain('https://admin.example.test');
  });

  it.each(['*', 'file:///tmp/app', 'https://user:pass@example.test', 'https://example.test/path'])(
    'rejects unsafe origin %s',
    (origin) => expect(() => resolveCorsOrigins(origin)).toThrow('CORS_ORIGINS'),
  );
});
