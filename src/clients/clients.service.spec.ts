import { ClientsService } from './clients.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ConflictException } from '@nestjs/common';

it('creates a server-owned UUID and maps supported profile fields', async () => {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.single = jest.fn().mockResolvedValue({ data: { id: 'saved' } });
  const insert = jest.fn(() => chain);
  const supabase = { getAdminClient: () => ({ from: () => ({ insert }) }) };
  const service = new ClientsService(supabase as unknown as SupabaseService);
  await service.create(
    { name: 'Test', phone: '0901', note: 'Khách quen' },
    'owner',
  );
  expect(insert).toHaveBeenCalledWith({
    id: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ),
    name: 'Test',
    phone: '0901',
    note: 'Khách quen',
    user_id: 'owner',
  });
});

it('updates only supplied customer fields under the owner boundary', async () => {
  const findQuery: Record<string, jest.Mock> = {};
  findQuery.select = jest.fn(() => findQuery);
  findQuery.eq = jest.fn(() => findQuery);
  findQuery.maybeSingle = jest
    .fn()
    .mockResolvedValue({ data: { id: 'client-1' } });
  const updateQuery: Record<string, jest.Mock> = {};
  updateQuery.update = jest.fn(() => updateQuery);
  updateQuery.eq = jest.fn(() => updateQuery);
  updateQuery.select = jest.fn(() => updateQuery);
  updateQuery.maybeSingle = jest
    .fn()
    .mockResolvedValue({ data: { id: 'client-1', phone: null } });
  const from = jest
    .fn()
    .mockReturnValueOnce(findQuery)
    .mockReturnValueOnce(updateQuery);
  const service = new ClientsService({
    getAdminClient: () => ({ from }),
  } as unknown as SupabaseService);

  await service.update('client-1', { phone: null }, 'owner');

  expect(updateQuery.update).toHaveBeenCalledWith({ phone: null });
  expect(updateQuery.eq).toHaveBeenCalledWith('id', 'client-1');
  expect(updateQuery.eq).toHaveBeenCalledWith('user_id', 'owner');
});

it('returns a clear conflict when a customer still has projects', async () => {
  const findQuery: Record<string, jest.Mock> = {};
  findQuery.select = jest.fn(() => findQuery);
  findQuery.eq = jest.fn(() => findQuery);
  findQuery.maybeSingle = jest
    .fn()
    .mockResolvedValue({ data: { id: 'client-1' } });
  const deleteQuery: Record<string, jest.Mock> = {};
  deleteQuery.delete = jest.fn(() => deleteQuery);
  deleteQuery.eq = jest
    .fn()
    .mockReturnValueOnce(deleteQuery)
    .mockResolvedValueOnce({ error: { code: '23503' } });
  const from = jest
    .fn()
    .mockReturnValueOnce(findQuery)
    .mockReturnValueOnce(deleteQuery);
  const service = new ClientsService({
    getAdminClient: () => ({ from }),
  } as unknown as SupabaseService);

  await expect(service.delete('client-1', 'owner')).rejects.toBeInstanceOf(
    ConflictException,
  );
});
