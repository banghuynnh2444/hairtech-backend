import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('AuthService security regressions', () => {
  function setup() {
    const user = { id: 'new-user', email: 'test@example.invalid' };
    const auth = {
      admin: {
        createUser: jest.fn().mockResolvedValue({ data: { user }, error: null }),
        deleteUser: jest.fn().mockResolvedValue({ error: null }),
      },
      signInWithPassword: jest.fn().mockResolvedValue({ data: { user }, error: null }),
    };
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const admin = {
      rpc: jest.fn().mockResolvedValue({ data: 'device-id', error: null }),
      from: jest.fn().mockReturnValue({ upsert }),
    };
    const supabase = { createAuthClient: jest.fn(() => ({ auth })), getAdminClient: jest.fn(() => admin) };
    const jwt = { sign: jest.fn().mockReturnValue('app-token') };
    const service = new AuthService(supabase as unknown as SupabaseService, jwt as unknown as JwtService);
    return { service, auth, admin, jwt, upsert };
  }
  const registration = { email: 'test@example.invalid', password: 'not-a-real-password', salonName: 'Salon' };
  const login = { ...registration, deviceFingerprint: 'os-machine-id', deviceName: 'Windows PC', platform: 'windows' };

  it('initializes the verified profile and subscription schema before reporting success', async () => {
    const { service, admin, auth } = setup();
    await expect(service.register(registration)).resolves.toMatchObject({ success: true });
    expect(admin.rpc).toHaveBeenCalledWith('initialize_trial_account', {
      p_user_id: 'new-user', p_email: registration.email, p_full_name: 'Salon',
    });
    expect(auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it.each([false, true])('compensates a newly created Auth user on database failure (throw=%s)', async (throws) => {
    const { service, admin, auth } = setup();
    if (throws) admin.rpc.mockRejectedValue(new Error('network'));
    else admin.rpc.mockResolvedValue({ error: { code: '42501' } });
    await expect(service.register(registration)).rejects.toThrow('Chưa thể khởi tạo');
    expect(auth.admin.deleteUser).toHaveBeenCalledWith('new-user');
  });

  it('does not delete or initialize a user when Auth creation fails', async () => {
    const { service, auth, admin } = setup();
    auth.admin.createUser.mockResolvedValue({ data: {}, error: { message: 'exists' } });
    await expect(service.register(registration)).rejects.toThrow('exists');
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('uses the isolated login client and database RPC before creating a session', async () => {
    const { service, auth, admin, upsert, jwt } = setup();
    await expect(service.login(login)).resolves.toMatchObject({ accessToken: 'app-token' });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: login.email, password: login.password });
    expect(admin.rpc).toHaveBeenCalledWith('register_device', expect.objectContaining({ p_user_id: 'new-user', p_fingerprint: 'os-machine-id' }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'new-user', device_id: 'device-id' }), { onConflict: 'user_id' });
    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-id' }));
  });

  it('rejects a third device without creating a session or token', async () => {
    const { service, admin, jwt } = setup();
    admin.rpc.mockResolvedValue({ error: { message: 'DEVICE_LIMIT_EXCEEDED' } });
    await expect(service.login(login)).rejects.toMatchObject({ response: { code: 'DEVICE_LIMIT_EXCEEDED' } });
    expect(admin.from).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('fails closed on device query errors instead of treating an unknown count as zero', async () => {
    const { service, admin, jwt } = setup();
    admin.rpc.mockResolvedValue({ error: { code: '42501' } });
    await expect(service.login(login)).rejects.toThrow('Không thể kiểm tra');
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('does not mint a JWT if creating the active session fails', async () => {
    const { service, upsert, jwt } = setup();
    upsert.mockResolvedValue({ error: { code: '42501' } });
    await expect(service.login(login)).rejects.toThrow('Không thể khởi tạo phiên');
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it.each(['', '   ', undefined])('rejects a missing fingerprint (%s) before authentication', async (deviceFingerprint) => {
    const { service, auth } = setup();
    await expect(service.login({ ...login, deviceFingerprint: deviceFingerprint as string })).rejects.toThrow('mã định danh');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});
