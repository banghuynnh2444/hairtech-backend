import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateDiagramDto, UpdateDiagramDto, validateDiagram } from './diagrams.dto';

// Exclude obsolete image/base64 columns and omit the large document from lists.
const SUMMARY_COLUMNS = 'id,user_id,client_id,type,name,notes,thumbnail_url,created_at,updated_at';
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS},project_data`;

@Injectable()
export class DiagramsService {
  constructor(private readonly supabase: SupabaseService) {}

  private async assertClientOwner(clientId: string, userId: string) {
    const { data, error } = await this.supabase.getAdminClient().from('clients')
      .select('id').eq('id', clientId).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Không tìm thấy khách hàng');
  }
  async findByClient(clientId: string, userId: string) {
    await this.assertClientOwner(clientId, userId);
    const { data, error } = await this.supabase.getAdminClient().from('diagrams')
      .select(SUMMARY_COLUMNS).eq('client_id', clientId).eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }
  async findOne(id: string, userId: string) {
    const { data, error } = await this.supabase.getAdminClient().from('diagrams')
      .select(DETAIL_COLUMNS).eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Không tìm thấy sơ đồ');
    return data;
  }
  async create(body: CreateDiagramDto, userId: string) {
    const dto = validateDiagram(body, true);
    if (dto.client_id != null) await this.assertClientOwner(dto.client_id, userId);
    const { data, error } = await this.supabase.getAdminClient().from('diagrams')
      .insert({
        id: randomUUID(), user_id: userId, client_id: dto.client_id ?? null,
        type: dto.type, name: dto.name, notes: dto.notes ?? null,
        thumbnail_url: dto.thumbnail_url ?? null, project_data: dto.project_data,
      }).select(DETAIL_COLUMNS).single();
    if (error) throw error;
    return data;
  }
  async update(id: string, body: UpdateDiagramDto, userId: string) {
    const dto = validateDiagram(body, false);
    await this.findOne(id, userId);
    if (dto.client_id != null) await this.assertClientOwner(dto.client_id, userId);
    const fields: Record<string, unknown> = {};
    if (dto.client_id !== undefined) fields.client_id = dto.client_id;
    if (dto.type !== undefined) fields.type = dto.type;
    if (dto.name !== undefined) fields.name = dto.name;
    if (dto.notes !== undefined) fields.notes = dto.notes;
    if (dto.thumbnail_url !== undefined) fields.thumbnail_url = dto.thumbnail_url;
    if (dto.project_data !== undefined) fields.project_data = dto.project_data;
    // Database trigger also timestamps writes made outside this service.
    const { data, error } = await this.supabase.getAdminClient().from('diagrams')
      .update(fields).eq('id', id).eq('user_id', userId).select(DETAIL_COLUMNS).maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Không tìm thấy sơ đồ');
    return data;
  }
  async delete(id: string, userId: string) {
    const { data, error } = await this.supabase.getAdminClient().from('diagrams')
      .delete().eq('id', id).eq('user_id', userId).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Không tìm thấy sơ đồ');
    return { success: true, message: 'Đã xóa sơ đồ' };
  }
}
