import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateClientDto, UpdateClientDto } from './clients.dto';

const CLIENT_COLUMNS = 'id,user_id,name,phone,note,created_at,updated_at';

@Injectable()
export class ClientsService {
  constructor(private readonly supabase: SupabaseService) {}

  async findAll(userId: string) {
    const client = this.supabase.getAdminClient();
    const { data, error } = await client
      .from('clients')
      .select(CLIENT_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  async findOne(id: string, userId: string) {
    const client = this.supabase.getAdminClient();
    const { data, error } = await client
      .from('clients')
      .select(CLIENT_COLUMNS)
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data)
      throw new NotFoundException('Không tìm thấy thông tin khách hàng');
    return data;
  }

  async create(dto: CreateClientDto, userId: string) {
    const client = this.supabase.getAdminClient();
    const { data, error } = await client
      .from('clients')
      .insert({
        id: randomUUID(),
        name: dto.name,
        phone: dto.phone ?? null,
        note: dto.note ?? null,
        user_id: userId,
      })
      .select(CLIENT_COLUMNS)
      .single();

    if (error) throw error;
    return data;
  }

  async update(id: string, dto: UpdateClientDto, userId: string) {
    await this.findOne(id, userId); // Kiểm tra quyền sở hữu
    const client = this.supabase.getAdminClient();
    const fields: Record<string, unknown> = {};
    if (dto.name !== undefined) fields.name = dto.name;
    if (dto.phone !== undefined) fields.phone = dto.phone;
    if (dto.note !== undefined) fields.note = dto.note;
    const { data, error } = await client
      .from('clients')
      .update(fields)
      .eq('id', id)
      .eq('user_id', userId)
      .select(CLIENT_COLUMNS)
      .maybeSingle();

    if (error) throw error;
    if (!data)
      throw new NotFoundException('Không tìm thấy thông tin khách hàng');
    return data;
  }

  async delete(id: string, userId: string) {
    await this.findOne(id, userId);
    const client = this.supabase.getAdminClient();
    const { error } = await client
      .from('clients')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      if (error.code === '23503') {
        throw new ConflictException({
          code: 'CLIENT_HAS_PROJECTS',
          message: 'Hãy xóa các project của khách hàng trước khi xóa hồ sơ.',
        });
      }
      throw error;
    }
    return { success: true, message: 'Đã xóa khách hàng' };
  }
}
