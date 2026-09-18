import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AssignSubscriptionDto {
  @IsString({ message: 'Thiếu loại gói dịch vụ.' })
  @IsIn(['pro_monthly', 'pro_yearly'], {
    message: 'Loại gói chỉ được là pro_monthly hoặc pro_yearly.',
  })
  planTier: 'pro_monthly' | 'pro_yearly';

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Thời hạn phải là số nguyên (tháng).' })
  @Min(1, { message: 'Thời hạn tối thiểu là 1 tháng.' })
  @Max(120, { message: 'Thời hạn tối đa là 120 tháng.' })
  durationMonths?: number = 1;
}

export class AdminUserQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['all', 'pending', 'active', 'expired'], {
    message: 'Bộ lọc trạng thái không hợp lệ.',
  })
  status?: 'all' | 'pending' | 'active' | 'expired' = 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
