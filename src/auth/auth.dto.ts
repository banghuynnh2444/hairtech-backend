import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDto {
  @Transform(trim)
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  @MaxLength(254, { message: 'Email quá dài.' })
  email!: string;

  @IsString({ message: 'Mật khẩu không hợp lệ.' })
  @Length(8, 72, { message: 'Mật khẩu phải có từ 8 đến 72 ký tự.' })
  password!: string;

  @Transform(trim)
  @IsString({ message: 'Tên Salon / Stylist không hợp lệ.' })
  @Length(1, 120, { message: 'Tên Salon / Stylist phải có từ 1 đến 120 ký tự.' })
  salonName!: string;
}

export class LoginDto {
  @Transform(trim)
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  @MaxLength(254, { message: 'Email quá dài.' })
  email!: string;

  @IsString({ message: 'Mật khẩu không hợp lệ.' })
  @Length(1, 72, { message: 'Mật khẩu không hợp lệ.' })
  password!: string;

  @Transform(trim)
  @IsString({ message: 'Mã định danh thiết bị không hợp lệ.' })
  @Length(1, 256, { message: 'Mã định danh thiết bị không hợp lệ.' })
  deviceFingerprint!: string;

  @Transform(trim)
  @IsString({ message: 'Tên thiết bị không hợp lệ.' })
  @Length(1, 128, { message: 'Tên thiết bị không hợp lệ.' })
  deviceName!: string;

  @Transform(trim)
  @IsIn(['windows', 'macos', 'linux'], { message: 'Nền tảng thiết bị không hợp lệ.' })
  platform!: string;

  @Transform(trim)
  @IsOptional()
  @IsString({ message: 'Phiên bản ứng dụng không hợp lệ.' })
  @MaxLength(64, { message: 'Phiên bản ứng dụng không hợp lệ.' })
  clientVersion?: string;
}

export class DeviceFingerprintDto {
  @Transform(trim)
  @IsString({ message: 'Thiếu mã định danh thiết bị.' })
  @Length(1, 256, { message: 'Mã định danh thiết bị không hợp lệ.' })
  deviceFingerprint!: string;
}

export class ForgotPasswordDto {
  @Transform(trim)
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  @MaxLength(254, { message: 'Email quá dài.' })
  email!: string;
}

export class ResetPasswordDto {
  @IsString({ message: 'Liên kết khôi phục không hợp lệ.' })
  @MinLength(20, { message: 'Liên kết khôi phục không hợp lệ.' })
  @MaxLength(8192, { message: 'Liên kết khôi phục không hợp lệ.' })
  accessToken!: string;

  @IsString({ message: 'Mật khẩu mới không hợp lệ.' })
  @Length(8, 72, { message: 'Mật khẩu mới phải có từ 8 đến 72 ký tự.' })
  password!: string;
}
