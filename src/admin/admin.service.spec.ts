import { AdminService } from './admin.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('AdminService', () => {
  it('approves a user and sets is_approved to true', async () => {
    const chain: Record<string, jest.Mock> = {};
    chain.update = jest.fn(() => chain);
    chain.eq = jest.fn(() => chain);
    chain.select = jest.fn(() => chain);
    chain.maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: { id: 'u-1', email: 'test@salon.vn', is_approved: true } });

    const supabase = {
      getAdminClient: () => ({
        from: () => chain,
      }),
    };

    const service = new AdminService(supabase as unknown as SupabaseService);
    const result = await service.approveUser('u-1');

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_approved: true }),
    );
    expect(chain.eq).toHaveBeenCalledWith('id', 'u-1');
    expect(result.success).toBe(true);
    expect(result.user.is_approved).toBe(true);
  });

  it('revokes a user and sets is_approved to false', async () => {
    const chain: Record<string, jest.Mock> = {};
    chain.update = jest.fn(() => chain);
    chain.eq = jest.fn(() => chain);
    chain.select = jest.fn(() => chain);
    chain.maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: { id: 'u-1', email: 'test@salon.vn', is_approved: false } });

    const supabase = {
      getAdminClient: () => ({
        from: () => chain,
      }),
    };

    const service = new AdminService(supabase as unknown as SupabaseService);
    const result = await service.revokeUser('u-1');

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_approved: false }),
    );
    expect(chain.eq).toHaveBeenCalledWith('id', 'u-1');
    expect(result.success).toBe(true);
    expect(result.user.is_approved).toBe(false);
  });

  it('assigns a paid subscription with calculated end date and activates user', async () => {
    const profileChain: Record<string, jest.Mock> = {};
    profileChain.select = jest.fn(() => profileChain);
    profileChain.eq = jest.fn(() => profileChain);
    profileChain.maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: { id: 'u-1', email: 'test@salon.vn', is_approved: false } });
    profileChain.update = jest.fn(() => profileChain);

    const subChain: Record<string, jest.Mock> = {};
    subChain.upsert = jest.fn(() => subChain);
    subChain.select = jest.fn(() => subChain);
    subChain.single = jest.fn().mockResolvedValue({
      data: {
        id: 'sub-1',
        user_id: 'u-1',
        plan_tier: 'pro_monthly',
        status: 'active',
      },
      error: null,
    });

    const supabase = {
      getAdminClient: () => ({
        from: (table: string) => (table === 'profiles' ? profileChain : subChain),
      }),
    };

    const service = new AdminService(supabase as unknown as SupabaseService);
    const result = await service.assignSubscription('u-1', {
      planTier: 'pro_monthly',
      durationMonths: 3,
    });

    expect(subChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u-1',
        plan_tier: 'pro_monthly',
        status: 'active',
      }),
      { onConflict: 'user_id' },
    );
    expect(result.success).toBe(true);
    expect(profileChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_approved: true }),
    );
  });

  it('resets a user device by calling reset_account_device RPC', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    const supabase = {
      getAdminClient: () => ({ rpc }),
    };

    const service = new AdminService(supabase as unknown as SupabaseService);
    const result = await service.resetDevice('u-1');

    expect(rpc).toHaveBeenCalledWith('reset_account_device', {
      p_user_id: 'u-1',
    });
    expect(result.success).toBe(true);
  });

  it('computes dashboard stats accurately', async () => {
    const profilesQuery: Record<string, jest.Mock> = {};
    profilesQuery.select = jest.fn().mockResolvedValue({ count: 10 });

    const pendingQuery: Record<string, jest.Mock> = {};
    pendingQuery.select = jest.fn(() => pendingQuery);
    pendingQuery.eq = jest.fn().mockResolvedValue({ count: 3 });

    const subsQuery: Record<string, jest.Mock> = {};
    subsQuery.select = jest.fn(() => subsQuery);
    subsQuery.eq = jest.fn(() => subsQuery);
    subsQuery.gt = jest.fn().mockResolvedValue({
      data: [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }],
    });

    const from = jest
      .fn()
      .mockReturnValueOnce(profilesQuery)
      .mockReturnValueOnce(pendingQuery)
      .mockReturnValueOnce(subsQuery);

    const supabase = {
      getAdminClient: () => ({ from }),
    };

    const service = new AdminService(supabase as unknown as SupabaseService);
    const stats = await service.getStats();

    expect(stats.totalUsers).toBe(10);
    expect(stats.pendingApprovals).toBe(3);
    expect(stats.activeSubscribers).toBe(4);
    expect(stats.expiredSubscribers).toBe(3); // 10 - 3 - 4 = 3
  });
});
