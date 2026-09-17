import { BadRequestException } from '@nestjs/common';
import { ClientsService } from '../clients/clients.service';
import { SupabaseService } from '../supabase/supabase.service';
import {
  MAX_PHOTO_BYTES,
  PhotosService,
  detectPhotoFormat,
  validatePhotoFile,
  type UploadedPhotoFile,
} from './photos.service';

function jpeg(name = 'before.jpg'): UploadedPhotoFile {
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  return { buffer, originalname: name, mimetype: 'image/jpeg', size: buffer.length };
}

describe('customer photo validation', () => {
  it('detects allowed image signatures instead of trusting the extension', () => {
    expect(detectPhotoFormat(jpeg().buffer)).toEqual({ mime: 'image/jpeg', extension: 'jpg' });
    expect(detectPhotoFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      .toEqual({ mime: 'image/png', extension: 'png' });
    expect(detectPhotoFormat(Buffer.from('RIFFxxxxWEBP'))).toEqual({ mime: 'image/webp', extension: 'webp' });
    expect(detectPhotoFormat(Buffer.from('<svg>'))).toBeNull();
  });

  it('rejects missing, spoofed and oversized files', () => {
    expect(() => validatePhotoFile(undefined)).toThrow(BadRequestException);
    expect(() => validatePhotoFile({ ...jpeg(), mimetype: 'image/png' })).toThrow('JPEG, PNG hoặc WebP');
    expect(() => validatePhotoFile({ ...jpeg(), size: MAX_PHOTO_BYTES + 1 })).toThrow('8 MB');
  });
});

describe('PhotosService', () => {
  it('checks client ownership before touching storage', async () => {
    const clients = { findOne: jest.fn().mockRejectedValue(new Error('foreign client')) };
    const admin = { storage: { from: jest.fn() }, from: jest.fn() };
    const service = new PhotosService(
      { getAdminClient: () => admin } as unknown as SupabaseService,
      clients as unknown as ClientsService,
    );
    await expect(service.upload('foreign', 'owner', 'before', jpeg())).rejects.toThrow('foreign client');
    expect(admin.storage.from).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('stores a server-owned path and returns a short-lived signed URL', async () => {
    const clients = { findOne: jest.fn().mockResolvedValue({ id: 'client-1' }) };
    const existingQuery: Record<string, jest.Mock> = {};
    existingQuery.select = jest.fn(() => existingQuery);
    existingQuery.eq = jest.fn(() => existingQuery);
    existingQuery.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    const insertQuery: Record<string, jest.Mock> = {};
    insertQuery.insert = jest.fn(() => insertQuery);
    insertQuery.select = jest.fn(() => insertQuery);
    insertQuery.single = jest.fn().mockImplementation(async () => ({
      data: insertQuery.insert.mock.calls[0][0], error: null,
    }));
    const from = jest.fn()
      .mockReturnValueOnce(existingQuery)
      .mockReturnValueOnce(insertQuery);
    const bucket = {
      upload: jest.fn().mockResolvedValue({ error: null }),
      remove: jest.fn().mockResolvedValue({ error: null }),
      createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.invalid/photo' }, error: null }),
    };
    const admin = { from, storage: { from: jest.fn(() => bucket) } };
    const service = new PhotosService(
      { getAdminClient: () => admin } as unknown as SupabaseService,
      clients as unknown as ClientsService,
    );

    const result = await service.upload('client-1', 'owner', 'before', jpeg('../unsafe.jpg'));
    const path = bucket.upload.mock.calls[0][0] as string;
    expect(path).toMatch(/^users\/owner\/clients\/client-1\/before\/[\da-f-]+\.jpg$/);
    expect(insertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'owner', client_id: 'client-1', kind: 'before',
      storage_path: path, original_name: 'unsafe.jpg', mime_type: 'image/jpeg',
    }));
    expect(result).toMatchObject({ url: 'https://signed.invalid/photo', storage_path: path });
  });
});
