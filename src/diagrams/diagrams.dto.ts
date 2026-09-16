import { BadRequestException, Injectable } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// Storage contract only. Scene serialization/restoration belongs to phase 4.
export interface ProjectDataV1 {
  version: 1;
  drawing_2d: JsonObject[];
  nodes_3d: JsonObject[];
  sections: JsonObject[];
  perm_rods: JsonObject[];
  waves: JsonObject[];
  timeline: { entries: JsonObject[]; cursor: number };
  camera: { position: [number, number, number]; target: [number, number, number]; zoom: number };
  settings: JsonObject;
}

export class CreateDiagramDto {
  client_id?: string | null;
  type: string;
  name: string;
  notes?: string | null;
  thumbnail_url?: string | null;
  project_data: ProjectDataV1;
}
export class UpdateDiagramDto {
  client_id?: string | null;
  type?: string;
  name?: string;
  notes?: string | null;
  thumbnail_url?: string | null;
  project_data?: ProjectDataV1;
}

function fail(message: string): never { throw new BadRequestException({ code: 'INVALID_DIAGRAM', message }); }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('Dữ liệu chứa trường không được hỗ trợ.');
}
function validateJson(value: unknown, depth = 0): void {
  if (depth > 64) fail('Dữ liệu project lồng quá nhiều cấp.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string') {
    if (/^\s*data:/i.test(value)) fail('Hãy dùng đường dẫn ảnh, không nhúng ảnh base64 vào project.');
    return;
  }
  if (Array.isArray(value)) { value.forEach(item => validateJson(item, depth + 1)); return; }
  if (object(value)) { Object.values(value).forEach(item => validateJson(item, depth + 1)); return; }
  fail('Project chỉ được chứa dữ liệu JSON thuần.');
}
function validateProject(value: unknown): asserts value is ProjectDataV1 {
  if (!object(value) || value.version !== 1) fail('Chỉ hỗ trợ project_data phiên bản 1 khi ghi mới.');
  const collections = ['drawing_2d', 'nodes_3d', 'sections', 'perm_rods', 'waves'];
  keys(value, ['version', ...collections, 'timeline', 'camera', 'settings']);
  validateJson(value);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 4 * 1024 * 1024) fail('Project vượt giới hạn 4 MiB.');
  for (const key of collections) {
    if (!Array.isArray(value[key]) || !(value[key] as unknown[]).every(object)) fail(`Thiếu hoặc sai danh sách ${key}.`);
  }
  const timeline = value.timeline;
  if (!object(timeline) || !Array.isArray(timeline.entries) || !timeline.entries.every(object)
    || !Number.isInteger(timeline.cursor) || (timeline.cursor as number) < 0
    || (timeline.cursor as number) > timeline.entries.length) fail('Timeline hoặc vị trí hoàn tác không hợp lệ.');
  keys(timeline, ['entries', 'cursor']);
  const camera = value.camera;
  if (!object(camera)) fail('Thiếu thông tin camera.');
  keys(camera, ['position', 'target', 'zoom']);
  for (const field of ['position', 'target']) {
    const vector = camera[field];
    if (!Array.isArray(vector) || vector.length !== 3
      || !vector.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) fail('Tọa độ camera không hợp lệ.');
  }
  if (typeof camera.zoom !== 'number' || !Number.isFinite(camera.zoom) || camera.zoom <= 0) fail('Zoom camera không hợp lệ.');
  if (!object(value.settings)) fail('Thiếu thiết lập project.');
}
export function validateDiagram(value: unknown, create: true): CreateDiagramDto;
export function validateDiagram(value: unknown, create: false): UpdateDiagramDto;
export function validateDiagram(value: unknown, create: boolean): CreateDiagramDto | UpdateDiagramDto {
  if (!object(value)) fail('Dữ liệu sơ đồ phải là một object.');
  keys(value, ['client_id', 'type', 'name', 'notes', 'thumbnail_url', 'project_data']);
  if (!create && Object.keys(value).length === 0) fail('Chưa có trường nào cần cập nhật.');
  for (const [key, max] of [['type', 64], ['name', 200]] as const) {
    if (create || Object.hasOwn(value, key)) {
      if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > max) fail(`${key} không hợp lệ.`);
    }
  }
  if (Object.hasOwn(value, 'client_id') && value.client_id !== null
    && (typeof value.client_id !== 'string' || !value.client_id.trim() || value.client_id.length > 256)) fail('client_id không hợp lệ.');
  if (Object.hasOwn(value, 'notes') && value.notes !== null && (typeof value.notes !== 'string' || value.notes.length > 20000)) fail('Ghi chú không hợp lệ.');
  if (Object.hasOwn(value, 'thumbnail_url') && value.thumbnail_url !== null) {
    if (typeof value.thumbnail_url !== 'string' || value.thumbnail_url.length > 2048) fail('Đường dẫn ảnh không hợp lệ.');
    try {
      const url = new URL(value.thumbnail_url);
      if (url.protocol !== 'https:' || url.username || url.password) fail('Ảnh thu nhỏ cần URL HTTPS.');
    } catch { fail('Ảnh thu nhỏ cần URL HTTPS, không phải base64.'); }
  }
  if (create || Object.hasOwn(value, 'project_data')) validateProject(value.project_data);
  return value as unknown as CreateDiagramDto | UpdateDiagramDto;
}
@Injectable()
export class DiagramValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.metatype === CreateDiagramDto) return validateDiagram(value, true);
    if (metadata.metatype === UpdateDiagramDto) return validateDiagram(value, false);
    return value;
  }
}
