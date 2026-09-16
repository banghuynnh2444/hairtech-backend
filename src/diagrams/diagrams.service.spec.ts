import { DiagramsService } from './diagrams.service';
import { SupabaseService } from '../supabase/supabase.service';
import { sampleProject } from './diagrams.fixture';

function setup(results: Array<{ data?: unknown; error?: unknown }>) {
  const queries: Array<Record<string, jest.Mock>> = [];
  const from = jest.fn(() => {
    const result = results.shift();
    if (!result) throw new Error('Unexpected database query');
    const q: Record<string, jest.Mock> = {};
    for (const method of ['select', 'eq', 'insert', 'update', 'delete']) q[method] = jest.fn(() => q);
    for (const method of ['single', 'maybeSingle', 'order']) q[method] = jest.fn().mockResolvedValue(result);
    queries.push(q);
    return q;
  });
  const service = new DiagramsService({ getAdminClient: () => ({ from }) } as unknown as SupabaseService);
  return { service, queries, from };
}
const create = () => ({ client_id: 'client-1', type: '3d', name: 'Layer', project_data: sampleProject() });

describe('DiagramsService ownership and canonical columns', () => {
  it('creates a complete document for a verified client, with a server generated ID', async () => {
    const dto = create();
    const { service, queries, from } = setup([{ data: { id: 'client-1' } }, { data: dto }]);
    await expect(service.create(dto, 'owner')).resolves.toEqual(dto);
    expect(from.mock.calls.map(() => null)).toHaveLength(2);
    expect(queries[0].eq).toHaveBeenCalledWith('user_id', 'owner');
    expect(queries[1].insert).toHaveBeenCalledWith({ id: expect.stringMatching(/^[\da-f-]{36}$/), user_id: 'owner', ...dto, notes: null, thumbnail_url: null });
    expect(queries[1].select).toHaveBeenCalledWith(expect.stringContaining('project_data'));
  });
  it('rejects a foreign/missing client before writing', async () => {
    const { service, queries } = setup([{ data: null }]);
    await expect(service.create(create(), 'owner')).rejects.toMatchObject({ status: 404 });
    expect(queries).toHaveLength(1);
    expect(queries[0].insert).not.toHaveBeenCalled();
  });
  it('supports a standalone project without a client', async () => {
    const { service, queries } = setup([{ data: { id: 'new' } }]);
    await service.create({ ...create(), client_id: null }, 'owner');
    expect(queries[0].insert).toHaveBeenCalledWith(expect.objectContaining({ client_id: null, user_id: 'owner' }));
  });
  it('updates only supplied fields and leaves creation time/project data intact', async () => {
    const { service, queries } = setup([{ data: { id: 'd1' } }, { data: { id: 'd1', name: 'New' } }]);
    await service.update('d1', { name: 'New', notes: null }, 'owner');
    expect(queries[1].update).toHaveBeenCalledWith({ name: 'New', notes: null });
    for (const q of queries) expect(q.eq).toHaveBeenCalledWith('user_id', 'owner');
  });
  it('checks ownership of replacement clients', async () => {
    const { service, queries } = setup([{ data: { id: 'd1' } }, { data: null }]);
    await expect(service.update('d1', { client_id: 'foreign' }, 'owner')).rejects.toMatchObject({ status: 404 });
    expect(queries).toHaveLength(2);
    expect(queries[1].eq).toHaveBeenCalledWith('id', 'foreign');
  });
  it('rejects injected update fields before database access', async () => {
    const { service, from } = setup([]);
    await expect(service.update('d1', { user_id: 'attacker' } as never, 'owner')).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });
  it('returns 404 for missing or foreign diagram reads and updates', async () => {
    const { service, queries } = setup([{ data: null }, { data: null }]);
    await expect(service.findOne('foreign', 'owner')).rejects.toMatchObject({ status: 404 });
    await expect(service.update('foreign', { name: 'x' }, 'owner')).rejects.toMatchObject({ status: 404 });
    queries.forEach(q => expect(q.eq).toHaveBeenCalledWith('user_id', 'owner'));
  });
  it('does not claim success if a diagram disappears between read and update', async () => {
    const { service } = setup([{ data: { id: 'd1' } }, { data: null }]);
    await expect(service.update('d1', { name: 'x' }, 'owner')).rejects.toMatchObject({ status: 404 });
  });
  it('lists only owned client metadata, ordered by created_at', async () => {
    const { service, queries } = setup([{ data: { id: 'client-1' } }, { data: [] }]);
    await expect(service.findByClient('client-1', 'owner')).resolves.toEqual([]);
    expect(queries[1].select.mock.calls[0][0]).not.toMatch(/project_data|history_data|\bimage\b|\*/);
    expect(queries[1].eq).toHaveBeenCalledWith('user_id', 'owner');
    expect(queries[1].order).toHaveBeenCalledWith('created_at', { ascending: false });
  });
  it('does not disclose diagram lists of a foreign client', async () => {
    const { service } = setup([{ data: null }]);
    await expect(service.findByClient('foreign', 'owner')).rejects.toMatchObject({ status: 404 });
  });
  it('deletes only by diagram ID and owner and returns 404 on missing rows', async () => {
    const { service, queries } = setup([{ data: { id: 'd1' } }, { data: null }]);
    await expect(service.delete('d1', 'owner')).resolves.toMatchObject({ success: true });
    await expect(service.delete('d2', 'owner')).rejects.toMatchObject({ status: 404 });
    queries.forEach(q => expect(q.eq).toHaveBeenCalledWith('user_id', 'owner'));
  });
  it('propagates database failure instead of reporting a successful write', async () => {
    const error = { code: '23503' };
    const { service } = setup([{ data: { id: 'client-1' } }, { error }]);
    await expect(service.create(create(), 'owner')).rejects.toEqual(error);
  });
});
