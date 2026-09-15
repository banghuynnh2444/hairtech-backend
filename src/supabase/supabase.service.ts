import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly adminClient: SupabaseClient;
  private readonly supabaseUrl: string;
  private readonly serviceRoleKey: string;

  constructor(configService: ConfigService) {
    this.supabaseUrl = configService.get<string>('SUPABASE_URL')?.trim() || '';
    this.serviceRoleKey = configService.get<string>('SUPABASE_SERVICE_ROLE_KEY')?.trim() || '';
    if (!this.supabaseUrl || !this.serviceRoleKey) {
      throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.');
    }
    if (!this.serviceRoleKey.startsWith('sb_secret_')) {
      let role: unknown;
      try {
        role = JSON.parse(Buffer.from(this.serviceRoleKey.split('.')[1], 'base64url').toString()).role;
      } catch { /* Report configuration only; never include the key. */ }
      if (role !== 'service_role') {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY phải là secret key hoặc JWT có role service_role.');
      }
    }

    // No Auth session can replace the service credentials on database requests.
    this.adminClient = createClient(this.supabaseUrl, this.serviceRoleKey, {
      accessToken: async () => null,
    });
  }

  getAdminClient(): SupabaseClient {
    return this.adminClient;
  }

  // Each authentication request owns its session, including concurrent logins.
  createAuthClient(): SupabaseClient {
    return createClient(this.supabaseUrl, this.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }
}
