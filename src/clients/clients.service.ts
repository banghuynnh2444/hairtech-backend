import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateClientDto, UpdateClientDto } from './clients.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly supabase: SupabaseService) {}

  async findAll(userId: string) {
    const client = this.supabase.getAdminClient();
    const { data, error } = await client
      .from('clients')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  async findOne(id: string, userId: string) {
    const client = this.supabase.getAdminClient();
    const { data, error } = await client
      .from('clients')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new NotFoundException('Không tìm thấy thông tin khách hàng');
    return data;
  }

  async create(dto: CreateClientDto, userId: string) {
    this.validateFields(dto);
    const client = this.supabase.getAdminClient();
    const { data, error } = await client
      .from('clients')
      .insert({
        id: randomUUID(),
        name: dto.name,
        user_id: userId,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async update(id: string, dto: UpdateClientDto, userId: string) {
    this.validateFields(dto);
    await this.findOne(id, userId); // Kiểm tra quyền sở hữu
    const client = this.supabase.getAdminClient();
    const { data, error } = await client
      .from('clients')
      .update({
        name: dto.name,
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  private validateFields(dto: CreateClientDto | UpdateClientDto) {
    if (dto.phone !== undefined || dto.note !== undefined) {
      throw new BadRequestException('Schema clients hiện chỉ hỗ trợ tên khách hàng, chưa có phone hoặc note.');
    }
  }

  async delete(id: string, userId: string) {
    await this.findOne(id, userId);
    const client = this.supabase.getAdminClient();
    const { error } = await client
      .from('clients')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;
    return { success: true, message: 'Đã xóa khách hàng' };
  }
}