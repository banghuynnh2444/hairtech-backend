import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClientsService } from '../clients/clients.service';
import { SupabaseService } from '../supabase/supabase.service';

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const BUCKET = 'client-photos';
const SIGNED_URL_SECONDS = 15 * 60;
const PHOTO_COLUMNS = 'id,user_id,client_id,kind,storage_path,original_name,mime_type,size_bytes,created_at,updated_at';
const PHOTO_KINDS = ['before', 'after', 'reference'] as const;

export type ClientPhotoKind = (typeof PHOTO_KINDS)[number];
export interface UploadedPhotoFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

interface PhotoFormat {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
}

export function detectPhotoFormat(buffer: Buffer): PhotoFormat | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp' };
  }
  return null;
}

export function validatePhotoFile(file: UploadedPhotoFile | undefined): PhotoFormat {
  if (!file?.buffer?.length) throw new BadRequestException('Chưa chọn ảnh để tải lên.');
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_PHOTO_BYTES
    || file.buffer.length !== file.size) {
    throw new BadRequestException('Ảnh phải nhỏ hơn hoặc bằng 8 MB.');
  }
  const format = detectPhotoFormat(file.buffer);
  if (!format || file.mimetype !== format.mime) {
    throw new BadRequestException('Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP hợp lệ.');
  }
  return format;
}

function photoKind(value: string): ClientPhotoKind {
  if (!PHOTO_KINDS.includes(value as ClientPhotoKind)) {
    throw new BadRequestException('Loại ảnh không hợp lệ.');
  }
  return value as ClientPhotoKind;
}

function cleanOriginalName(value: string): string {
  const cleaned = Array.from(basename(value || 'image'))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim();
  return (cleaned || 'image').slice(0, 255);
}

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly clients: ClientsService,
  ) {}

  private async signedPhoto(photo: Record<string, any>) {
    const { data, error } = await this.supabase.getAdminClient().storage
      .from(BUCKET)
      .createSignedUrl(photo.storage_path, SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new InternalServerErrorException('Chưa thể mở ảnh khách hàng.');
    }
    return {
      ...photo,
      url: data.signedUrl,
      url_expires_at: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString(),
    };
  }

  async list(clientId: string, userId: string) {
    await this.clients.findOne(clientId, userId);
    const { data, error } = await this.supabase.getAdminClient()
      .from('client_photos')
      .select(PHOTO_COLUMNS)
      .eq('client_id', clientId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return Promise.all((data ?? []).map((photo) => this.signedPhoto(photo)));
  }

  async upload(
    clientId: string,
    userId: string,
    rawKind: string,
    file: UploadedPhotoFile | undefined,
  ) {
    await this.clients.findOne(clientId, userId);
    const kind = photoKind(rawKind);
    const format = validatePhotoFile(file);
    const safeName = cleanOriginalName(file!.originalname);
    const storagePath = `users/${userId}/clients/${clientId}/${kind}/${randomUUID()}.${format.extension}`;
    const admin = this.supabase.getAdminClient();

    let existing: Record<string, any> | null = null;
    if (kind !== 'reference') {
      const result = await admin.from('client_photos')
        .select(PHOTO_COLUMNS)
        .eq('client_id', clientId)
        .eq('user_id', userId)
        .eq('kind', kind)
        .maybeSingle();
      if (result.error) throw result.error;
      existing = result.data;
    }

    const uploadResult = await admin.storage.from(BUCKET).upload(storagePath, file!.buffer, {
      contentType: format.mime,
      cacheControl: '3600',
      upsert: false,
    });
    if (uploadResult.error) {
      throw new InternalServerErrorException('Chưa thể tải ảnh lên kho lưu trữ.');
    }

    const fields = {
      user_id: userId,
      client_id: clientId,
      kind,
      storage_path: storagePath,
      original_name: safeName,
      mime_type: format.mime,
      size_bytes: file!.size,
    };
    const query = existing
      ? admin.from('client_photos').update(fields).eq('id', existing.id).eq('user_id', userId)
      : admin.from('client_photos').insert({ id: randomUUID(), ...fields });
    const saved = await query.select(PHOTO_COLUMNS).single();
    if (saved.error || !saved.data) {
      await admin.storage.from(BUCKET).remove([storagePath]);
      throw new InternalServerErrorException('Ảnh đã tải lên nhưng chưa thể lưu hồ sơ.');
    }

    if (existing?.storage_path && existing.storage_path !== storagePath) {
      const cleanup = await admin.storage.from(BUCKET).remove([existing.storage_path]);
      if (cleanup.error) this.logger.warn(`Không thể dọn ảnh cũ ${existing.id}.`);
    }
    return this.signedPhoto(saved.data);
  }

  async remove(clientId: string, photoId: string, userId: string) {
    await this.clients.findOne(clientId, userId);
    const admin = this.supabase.getAdminClient();
    const found = await admin.from('client_photos')
      .select(PHOTO_COLUMNS)
      .eq('id', photoId)
      .eq('client_id', clientId)
      .eq('user_id', userId)
      .maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) throw new NotFoundException('Không tìm thấy ảnh khách hàng.');

    const deleted = await admin.from('client_photos')
      .delete()
      .eq('id', photoId)
      .eq('user_id', userId);
    if (deleted.error) throw deleted.error;

    const storageDelete = await admin.storage.from(BUCKET).remove([found.data.storage_path]);
    if (storageDelete.error) this.logger.warn(`Không thể dọn object của ảnh ${photoId}.`);
    return { success: true };
  }
}
