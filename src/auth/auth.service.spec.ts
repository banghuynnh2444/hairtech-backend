import { JwtService } from '@nestjs/jwt';
import { AuthService, LoginDto } from './auth.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AccountAccessService } from '../access/account-access.service';
import { ConfigService } from '@nestjs/config';

describe('Phase 1 account/session flow', () => {
  function setup() {
    const user = { id: 'new-user', email: 'test@example.invalid' };
    const auth = {
      admin: {
        createUser: jest.fn().mockResolvedValue({ data: { user } }),
        deleteUser: jest.fn().mockResolvedValue({}),
        updateUserById: jest.fn().mockResolvedValue({ error: null }),
      },
      signInWithPassword: jest.fn().mockResolvedValue({ data: { user } }),
      resetPasswordForEmail: jest.fn().mockResolvedValue({ error: null }),
      getUser: jest.fn().mockResolvedValue({ data: { user }, error: null }),
    };
    const deleteEq = jest.fn().mockResolvedValue({ error: null });
    const admin = {
      rpc: jest.fn().mockResolvedValue({ data: 'device-id' }),
      from: jest.fn().mockReturnValue({ delete: () => ({ eq: deleteEq }) }),
    };
    const supabase = { createAuthClient: () => ({ auth }), getAdminClient: () => admin };
    const jwt = { sign: jest.fn().mockReturnValue('app-token'), verify: jest.fn().mockReturnValue({ sub: 'new-user', email: user.email, deviceId: 'device-id', sessionTokenHash: 'hash', tokenType: 'refresh' }) };
    const access = { verify: jest.fn().mockResolvedValue('2030-01-01T00:00:00Z') };
    const config = { get: jest.fn((key: string) => key === 'PASSWORD_RESET_REDIRECT_URL' ? 'https://api.example.test/auth/reset-password' : undefined) };
    const service = new AuthService(
      supabase as unknown as SupabaseService,
      jwt as unknown as JwtService,
      access as unknown as AccountAccessService,
      config as unknown as ConfigService,
    );
    return { service, auth, admin, jwt, access, config, deleteEq };
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
  it('sends a non-enumerating recovery email to the configured page', async () => {
    const { service, auth } = setup();
    await expect(service.forgotPassword(' Test@Example.invalid ')).resolves.toEqual(expect.objectContaining({ success: true }));
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('test@example.invalid', {
      redirectTo: 'https://api.example.test/auth/reset-password',
    });
  });
  it('updates the password from a verified recovery token and closes app sessions', async () => {
    const { service, auth, admin, deleteEq } = setup();
    await expect(service.resetPassword('valid-recovery-access-token', 'new-password-123')).resolves.toEqual(expect.objectContaining({ success: true }));
    expect(auth.getUser).toHaveBeenCalledWith('valid-recovery-access-token');
    expect(auth.admin.updateUserById).toHaveBeenCalledWith('new-user', { password: 'new-password-123' });
    expect(admin.from).toHaveBeenCalledWith('active_sessions');
    expect(deleteEq).toHaveBeenCalledWith('user_id', 'new-user');
  });
  it('only signs JWT after the atomic eligibility/binding/session RPC succeeds', async () => {
    const { service, admin, jwt, auth } = setup();
    await expect(service.login(login)).resolves.toMatchObject({ accessToken: 'app-token', refreshToken: 'app-token' });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: login.email, password: login.password });
    expect(admin.rpc).toHaveBeenCalledWith('open_account_session', expect.objectContaining({ p_user_id: 'new-user', p_fingerprint: 'os-id', p_client_version: '0.1.0', p_session_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(admin.from).not.toHaveBeenCalled();
    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-id', sessionTokenHash: expect.any(String), tokenType: 'access' }));
    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ tokenType: 'refresh' }), { expiresIn: '30d' });
  });
  it('rejects a missing JSON body without throwing a TypeError', async () => {
    const { service, auth } = setup();
    await expect(service.login(undefined as unknown as LoginDto)).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ message: 'Dữ liệu đăng nhập không hợp lệ.' }),
    });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
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
  it('renews a short access token only with a valid refresh token and active session', async () => {
    const { service, access, jwt } = setup();
    await expect(service.refresh('Bearer refresh-token', 'fp')).resolves.toEqual({ accessToken: 'app-token' });
    expect(jwt.verify).toHaveBeenCalledWith('refresh-token');
    expect(access.verify).toHaveBeenCalledWith('new-user', 'hash', 'device-id', 'fp', true);
    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ tokenType: 'access', deviceId: 'device-id' }));
  });
  it('rejects access tokens at the refresh endpoint', async () => {
    const { service, access, jwt } = setup();
    jwt.verify.mockReturnValue({ sub: 'new-user', deviceId: 'device-id', sessionTokenHash: 'hash', tokenType: 'access' });
    await expect(service.refresh('Bearer access-token', 'fp')).rejects.toMatchObject({ status: 401 });
    expect(access.verify).not.toHaveBeenCalled();
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
