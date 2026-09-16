import { BadRequestException, Injectable } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Allow } from 'class-validator';

export class CreateClientDto {
  @Allow()
  name: string;
  @Allow()
  phone?: string | null;
  @Allow()
  note?: string | null;
}

export class UpdateClientDto {
  @Allow()
  name?: string;
  @Allow()
  phone?: string | null;
  @Allow()
  note?: string | null;
}

function fail(message: string): never {
  throw new BadRequestException({ code: 'INVALID_CLIENT', message });
}

function validateText(
  value: unknown,
  label: string,
  maximum: number,
  required: boolean,
): string | null | undefined {
  if (value === undefined && !required) return undefined;
  if (value === null && !required) return null;
  if (typeof value !== 'string') fail(`${label} không hợp lệ.`);
  const normalized = value.trim();
  if (required && !normalized) fail(`${label} không được để trống.`);
  if (normalized.length > maximum) fail(`${label} vượt quá ${maximum} ký tự.`);
  return normalized || null;
}

export function validateClient(
  value: unknown,
  create: boolean,
): CreateClientDto | UpdateClientDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('Thông tin khách hàng phải là một object.');
  }
  const record = value as Record<string, unknown>;
  const allowed = ['name', 'phone', 'note'];
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    fail('Thông tin khách hàng chứa trường không được hỗ trợ.');
  }
  const provided = (key: string) => record[key] !== undefined;
  if (!create && !allowed.some(provided)) {
    fail('Chưa có thông tin khách hàng cần cập nhật.');
  }

  const result: UpdateClientDto = {};
  if (create || provided('name')) {
    result.name = validateText(
      record.name,
      'Tên khách hàng',
      200,
      true,
    ) as string;
  }
  if (provided('phone')) {
    result.phone = validateText(record.phone, 'Số điện thoại', 32, false);
  }
  if (provided('note')) {
    result.note = validateText(record.note, 'Ghi chú', 5_000, false);
  }
  return result as CreateClientDto | UpdateClientDto;
}

@Injectable()
export class ClientValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.metatype === CreateClientDto)
      return validateClient(value, true);
    if (metadata.metatype === UpdateClientDto)
      return validateClient(value, false);
    return value;
  }
}
