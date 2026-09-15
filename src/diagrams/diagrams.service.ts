import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateDiagramDto, UpdateDiagramDto } from './diagrams.dto';

@Injectable()
export class DiagramsService {
  constructor(private readonly supabase: SupabaseService) {}

  async findByClient(clientId: string, userId: string) {
    const client = this.supabase.getAdminClient();
    const { data, error } = await client
      .from('diagrams')
      .select('*')
      .eq('client_id', clientId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  async findOne(id: string, userId: string) {
    const client = this.supabase.getAdminClient();
    const { data, error } = await client
      .from('diagrams')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new NotFoundException('Không tìm thấy sơ đồ');
    return data;
  }

  async create(dto: CreateDiagramDto, userId: string) {
    const client = this.supabase.getAdminClient();
    const { data, error } = await client
      .from('diagrams')
      .insert({
        user_id: userId,
        client_id: dto.clientId,
        title: dto.title,
        data: dto.data,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async update(id: string, dto: UpdateDiagramDto, userId: string) {
    await this.findOne(id, userId);
    const client = this.supabase.getAdminClient();
    const { data, error } = await client
      .from('diagrams')
      .update({
        ...dto,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async delete(id: string, userId: string) {
    await this.findOne(id, userId);
    const client = this.supabase.getAdminClient();
    const { error } = await client
      .from('diagrams')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;
    return { success: true, message: 'Đã xóa sơ đồ' };
  }
}