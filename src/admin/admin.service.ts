import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AdminUserQueryDto, AssignSubscriptionDto } from './admin.dto';

export interface AdminUserListItem {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isApproved: boolean;
  createdAt: string;
  subscription: {
    planTier: string | null;
    status: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    isExpired: boolean;
  } | null;
  activeDevice: {
    id: string;
    deviceName: string;
    platform: string;
    deviceFingerprint: string;
    lastSeen: string | null;
  } | null;
}

@Injectable()
export class AdminService {
  constructor(private readonly supabase: SupabaseService) {}

  async listUsers(query: AdminUserQueryDto): Promise<{
    users: AdminUserListItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const admin = this.supabase.getAdminClient();

    let profilesQuery = admin
      .from('profiles')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (query.search && query.search.trim()) {
      const term = `%${query.search.trim()}%`;
      profilesQuery = profilesQuery.or(`email.ilike.${term},full_name.ilike.${term}`);
    }

    if (query.status === 'pending') {
      profilesQuery = profilesQuery.eq('is_approved', false);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const offset = (page - 1) * limit;

    profilesQuery = profilesQuery.range(offset, offset + limit - 1);

    const { data: profiles, error: pErr, count } = await profilesQuery;
    if (pErr) {
      throw new InternalServerErrorException('Không thể tải danh sách tài khoản: ' + pErr.message);
    }

    if (!profiles || profiles.length === 0) {
      return { users: [], total: count ?? 0, page, limit };
    }

    const userIds = profiles.map((p) => p.id);

    const [subsResult, devsResult] = await Promise.all([
      admin.from('subscriptions').select('*').in('user_id', userIds),
      admin.from('devices').select('*').in('user_id', userIds).eq('is_active', true),
    ]);

    const subMap = new Map<string, any>();
    if (subsResult.data) {
      subsResult.data.forEach((sub) => subMap.set(sub.user_id, sub));
    }

    const devMap = new Map<string, any>();
    if (devsResult.data) {
      devsResult.data.forEach((dev) => devMap.set(dev.user_id, dev));
    }

    const now = new Date();
    const items: AdminUserListItem[] = profiles.map((p) => {
      const sub = subMap.get(p.id);
      const dev = devMap.get(p.id);

      const isSubExpired =
        !sub ||
        sub.status !== 'active' ||
        !sub.current_period_end ||
        new Date(sub.current_period_end) <= now;

      return {
        id: p.id,
        email: p.email,
        fullName: p.full_name || '',
        role: p.role || 'salon_owner',
        isApproved: Boolean(p.is_approved),
        createdAt: p.created_at,
        subscription: sub
          ? {
              planTier: sub.plan_tier,
              status: sub.status,
              currentPeriodStart: sub.current_period_start,
              currentPeriodEnd: sub.current_period_end,
              isExpired: isSubExpired,
            }
          : null,
        activeDevice: dev
          ? {
              id: dev.id,
              deviceName: dev.device_name,
              platform: dev.platform,
              deviceFingerprint: dev.device_fingerprint,
              lastSeen: dev.last_seen,
            }
          : null,
      };
    });

    let filteredItems = items;
    if (query.status === 'active') {
      filteredItems = items.filter(
        (i) => i.isApproved && i.subscription && !i.subscription.isExpired,
      );
    } else if (query.status === 'expired') {
      filteredItems = items.filter(
        (i) => !i.subscription || i.subscription.isExpired,
      );
    }

    return {
      users: filteredItems,
      total: count ?? filteredItems.length,
      page,
      limit,
    };
  }

  async getStats() {
    const admin = this.supabase.getAdminClient();
    const now = new Date().toISOString();

    const [profilesRes, pendingRes, subsRes] = await Promise.all([
      admin.from('profiles').select('id', { count: 'exact', head: true }),
      admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('is_approved', false),
      admin
        .from('subscriptions')
        .select('id, status, current_period_end')
        .eq('status', 'active')
        .gt('current_period_end', now),
    ]);

    const totalUsers = profilesRes.count ?? 0;
    const pendingApprovals = pendingRes.count ?? 0;
    const activeSubscribers = subsRes.data?.length ?? 0;
    const expiredSubscribers = Math.max(0, totalUsers - pendingApprovals - activeSubscribers);

    return {
      totalUsers,
      pendingApprovals,
      activeSubscribers,
      expiredSubscribers,
    };
  }

  async approveUser(userId: string) {
    const admin = this.supabase.getAdminClient();
    const { data, error } = await admin
      .from('profiles')
      .update({ is_approved: true, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id, email, is_approved')
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Lỗi khi phê duyệt tài khoản: ' + error.message);
    }
    if (!data) {
      throw new NotFoundException('Không tìm thấy tài khoản người dùng.');
    }
    return { success: true, message: 'Đã phê duyệt tài khoản salon thành công.', user: data };
  }

  async revokeUser(userId: string) {
    const admin = this.supabase.getAdminClient();
    const { data, error } = await admin
      .from('profiles')
      .update({ is_approved: false, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id, email, is_approved')
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Lỗi khi thu hồi phê duyệt tài khoản: ' + error.message);
    }
    if (!data) {
      throw new NotFoundException('Không tìm thấy tài khoản người dùng.');
    }
    return { success: true, message: 'Đã thu hồi phê duyệt tài khoản.', user: data };
  }

  async assignSubscription(userId: string, dto: AssignSubscriptionDto) {
    const admin = this.supabase.getAdminClient();

    const { data: profile } = await admin
      .from('profiles')
      .select('id, email, is_approved')
      .eq('id', userId)
      .maybeSingle();

    if (!profile) {
      throw new NotFoundException('Không tìm thấy tài khoản người dùng.');
    }

    const durationMonths = dto.durationMonths ?? 1;
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + durationMonths);

    const { data: sub, error } = await admin
      .from('subscriptions')
      .upsert(
        {
          user_id: userId,
          plan_tier: dto.planTier,
          status: 'active',
          current_period_start: startDate.toISOString(),
          current_period_end: endDate.toISOString(),
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException('Không thể cấp gói dịch vụ: ' + error.message);
    }

    if (!profile.is_approved) {
      await admin
        .from('profiles')
        .update({ is_approved: true, updated_at: new Date().toISOString() })
        .eq('id', userId);
    }

    return {
      success: true,
      message: `Đã cấp gói ${dto.planTier} thành công (${durationMonths} tháng).`,
      subscription: sub,
    };
  }

  async resetDevice(userId: string) {
    const admin = this.supabase.getAdminClient();

    const { error } = await admin.rpc('reset_account_device', {
      p_user_id: userId,
    });

    if (error) {
      throw new InternalServerErrorException('Không thể reset thiết bị: ' + error.message);
    }

    return {
      success: true,
      message: 'Đã mở khóa thiết bị thành công. Người dùng có thể đăng nhập trên thiết bị mới.',
    };
  }
}
