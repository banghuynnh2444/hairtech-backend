import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AccountAccessService } from '../access/account-access.service';

describe('Phase 1 account/session flow', () => {
  function setup() {
    const user = { id: 'new-user', email: 'test@example.invalid' };
    const auth = {
      admin: { createUser: jest.fn().mockResolvedValue({ data: { user } }), deleteUser: jest.fn().mockResolvedValue({}) },
      signInWithPassword: jest.fn().mockResolvedValue({ data: { user } }),
    };
    const admin = { rpc: jest.fn().mockResolvedValue({ data: 'device-id' }), from: jest.fn() };
    const supabase = { createAuthClient: () => ({ auth }), getAdminClient: () => admin };
    const jwt = { sign: jest.fn().mockReturnValue('app-token'), verify: jest.fn().mockReturnValue({ sub: 'new-user', sessionTokenHash: 'hash' }) };
    const access = { verify: jest.fn().mockResolvedValue('2030-01-01T00:00:00Z') };
    const service = new AuthService(supabase as unknown as SupabaseService, jwt as unknown as JwtService, access as unknown as AccountAccessService);
    return { service, auth, admin, jwt, access };
  }
  const registration = { email: 'test@example.invalid', password: 'test-password', salonName: 'Salon' };
  const login = { ...registration, deviceFingerprint: 'os-id', deviceName: 'Windows', platform: 'windows', clientVersion: '0.1.0' };
  it('registers a pending profile without a trial or automatic subscription', async () => {
    const { service, admin } = setup();
    const response = await service.register(registration);
    expect(admin.rpc).toHaveBeenCalledWith('initialize_account', { p_user_id: 'new-user', p_email: registration.email, p_full_name: 'Salon' });
    expect(admin.from).not.toHaveBeenCalled();
    expect(response.message).toContain('phê duyệt');
    expect(response.message).not.toMatch(/trial|14|7 ngày|dùng thử/);
  });
  it.each([false, true])('compensates only newly created Auth user on DB failure (throw=%s)', async throws => {
    const { service, admin, auth } = setup();
    if (throws) admin.rpc.mockRejectedValue(new Error('network')); else admin.rpc.mockResolvedValue({ error: { code: '42501' } });
    await expect(service.register(registration)).rejects.toThrow('Chưa thể khởi tạo');
    expect(auth.admin.deleteUser).toHaveBeenCalledWith('new-user');
  });
  it('never deletes an existing user after Auth create failure', async () => {
    const { service, admin, auth } = setup();
    auth.admin.createUser.mockResolvedValue({ data: {}, error: { message: 'exists' } });
    await expect(service.register(registration)).rejects.toThrow('exists');
    expect(admin.rpc).not.toHaveBeenCalled(); expect(auth.admin.deleteUser).not.toHaveBeenCalled();
  });
  it('only signs JWT after the atomic eligibility/binding/session RPC succeeds', async () => {
    const { service, admin, jwt, auth } = setup();
    await expect(service.login(login)).resolves.toMatchObject({ accessToken: 'app-token' });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: login.email, password: login.password });
    expect(admin.rpc).toHaveBeenCalledWith('open_account_session', expect.objectContaining({ p_user_id: 'new-user', p_fingerprint: 'os-id', p_client_version: '0.1.0', p_session_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(admin.from).not.toHaveBeenCalled();
    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-id', sessionTokenHash: expect.any(String) }));
  });
  it.each(['ACCOUNT_NOT_APPROVED','PROFILE_NOT_FOUND','NO_SUBSCRIPTION','PAID_PLAN_REQUIRED','SUBSCRIPTION_INACTIVE','SUBSCRIPTION_EXPIRED','SUBSCRIPTION_NOT_STARTED','DEVICE_LIMIT_EXCEEDED'])('rejects %s without signing a token', async code => {
    const { service, admin, jwt } = setup();
    admin.rpc.mockResolvedValue({ error: { message: code } });
    await expect(service.login(login)).rejects.toMatchObject({ response: { code } });
    expect(jwt.sign).not.toHaveBeenCalled(); expect(admin.from).not.toHaveBeenCalled();
  });
  it('fails closed on unexpected database failure', async () => {
    const { service, admin, jwt } = setup();
    admin.rpc.mockResolvedValue({ error: { code: '42501' } });
    await expect(service.login(login)).rejects.toThrow('Không thể kiểm tra');
    expect(jwt.sign).not.toHaveBeenCalled();
  });
  it('does not bind after incorrect password', async () => {
    const { service, admin, auth } = setup();
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: {} });
    await expect(service.login(login)).rejects.toMatchObject({ status: 401 });
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it.each(['', '   ', undefined])('rejects missing fingerprint (%s)', async deviceFingerprint => {
    const { service, auth } = setup();
    await expect(service.login({ ...login, deviceFingerprint: deviceFingerprint as string })).rejects.toThrow('mã định danh');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it.each([
    { deviceName: '   ' },
    { platform: '' },
  ])('rejects incomplete device metadata before password login', async invalid => {
    const { service, auth } = setup();
    await expect(service.login({ ...login, ...invalid })).rejects.toThrow('Thông tin thiết bị');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it('checks startup access against the session/device/fingerprint', async () => {
    const { service, access } = setup();
    await expect(service.session({ sub: 'u', sessionTokenHash: 'h', deviceId: 'd' }, 'fp')).resolves.toMatchObject({ valid: true });
    expect(access.verify).toHaveBeenCalledWith('u','h','d','fp');
  });
  it('allows a signed expired token only for logout of its own session', async () => {
    const { service, admin, jwt } = setup();
    await expect(service.logout('Bearer old-signed-token')).resolves.toEqual({ success: true });
    expect(jwt.verify).toHaveBeenCalledWith('old-signed-token', { ignoreExpiration: true });
    expect(admin.rpc).toHaveBeenCalledWith('close_account_session', { p_user_id: 'new-user', p_session_hash: 'hash' });
  });
  it('does not revoke with an invalid signature', async () => {
    const { service, admin, jwt } = setup();
    jwt.verify.mockImplementation(() => { throw new Error('bad signature'); });
    await expect(service.logout('Bearer forged')).rejects.toMatchObject({ status: 401 });
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
