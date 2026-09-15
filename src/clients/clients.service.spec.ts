import { ClientsService } from './clients.service';
import { SupabaseService } from '../supabase/supabase.service';

it('creates a server-owned UUID and does not accept injected ownership or columns', async () => {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.single = jest.fn().mockResolvedValue({ data: { id: 'saved' } });
  const insert = jest.fn(() => chain);
  const supabase = { getAdminClient: () => ({ from: () => ({ insert }) }) };
  const service = new ClientsService(supabase as unknown as SupabaseService);
  await service.create({ name: 'Test', id: 'injected-id', user_id: 'someone-else' } as never, 'owner');
  expect(insert).toHaveBeenCalledWith({
    id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    name: 'Test', user_id: 'owner',
  });
});
