import { BadRequestException } from '@nestjs/common';
import { validateDiagram, DiagramValidationPipe, CreateDiagramDto, UpdateDiagramDto } from './diagrams.dto';
import { sampleProject } from './diagrams.fixture';

describe('Diagram storage validation', () => {
  const valid = () => ({ client_id: 'legacy-text-id', type: '3d', name: 'Layer 90°', project_data: sampleProject() });
  it('preserves every project section and the redo cursor', () => {
    const dto = valid();
    expect(validateDiagram(dto, true)).toEqual(dto);
    expect(dto.project_data.timeline.cursor).toBeLessThan(dto.project_data.timeline.entries.length);
  });
  it.each(['title', 'data', 'clientId', 'id', 'user_id', 'created_at', 'updated_at', 'image', 'history_data'])('rejects old/injected field %s', field => {
    expect(() => validateDiagram({ ...valid(), [field]: 'injected' }, true)).toThrow(BadRequestException);
    expect(() => validateDiagram({ [field]: 'injected' }, false)).toThrow(BadRequestException);
  });
  it.each([null, [], {}, { name: '' }, { name: 'a', type: '3d', project_data: { version: 0 } }])('rejects malformed create body %p', value => {
    expect(() => validateDiagram(value, true)).toThrow(BadRequestException);
  });
  it('allows explicit clearing of nullable fields but rejects null required fields', () => {
    expect(validateDiagram({ notes: null, thumbnail_url: null, client_id: null }, false)).toEqual({ notes: null, thumbnail_url: null, client_id: null });
    for (const field of ['project_data', 'name', 'type']) expect(() => validateDiagram({ [field]: null }, false)).toThrow();
  });
  it('rejects missing scene sections, invalid versions, camera and cursor', () => {
    for (const change of [{ version: 2 }, { waves: undefined }, { nodes_3d: {} }, { settings: [] },
      { timeline: { entries: [], cursor: 1 } }, { camera: { position: [1, 2], target: [0, 0, 0], zoom: 1 } }]) {
      expect(() => validateDiagram({ ...valid(), project_data: { ...sampleProject(), ...change } }, true)).toThrow();
    }
  });
  it('rejects embedded images and oversized documents', () => {
    expect(() => validateDiagram({ ...valid(), thumbnail_url: 'data:image/png;base64,AAAA' }, true)).toThrow();
    const project = sampleProject();
    project.settings.image = ' DATA:image/png;base64,AAAA';
    expect(() => validateDiagram({ ...valid(), project_data: project }, true)).toThrow();
    project.settings.image = 'x'.repeat(4 * 1024 * 1024);
    expect(() => validateDiagram({ ...valid(), project_data: project }, true)).toThrow();
  });
  it('rejects credentials in thumbnail URL and accepts HTTPS URL', () => {
    expect(() => validateDiagram({ thumbnail_url: 'https://user:pass@example.com/a' }, false)).toThrow();
    expect(validateDiagram({ thumbnail_url: 'https://example.invalid/a.png' }, false)).toEqual({ thumbnail_url: 'https://example.invalid/a.png' });
  });
  it('applies strict validation only to diagram request DTOs', () => {
    const pipe = new DiagramValidationPipe();
    expect(() => pipe.transform({ title: 'old' }, { type: 'body', metatype: CreateDiagramDto })).toThrow();
    expect(() => pipe.transform({}, { type: 'body', metatype: UpdateDiagramDto })).toThrow();
    expect(pipe.transform('text-id', { type: 'param', metatype: String })).toBe('text-id');
  });
  it('accepts a partial update after the global transform creates undefined class fields', () => {
    const transformed = Object.assign(new UpdateDiagramDto(), { name: 'Tên mới' });
    expect(validateDiagram(transformed, false)).toEqual({ name: 'Tên mới' });
    expect(() => validateDiagram(new UpdateDiagramDto(), false)).toThrow('Chưa có trường');
  });
});
