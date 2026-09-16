import { Controller, Post, Body, Headers, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService, LoginDto, RegisterDto } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('login')
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post('refresh')
  refresh(
    @Headers('authorization') authorization: string | undefined,
    @Body('deviceFingerprint') fingerprint: unknown,
  ) {
    return this.authService.refresh(authorization, fingerprint);
  }

  @Post('forgot-password')
  async forgotPassword(@Body('email') email: string) {
    return this.authService.forgotPassword(email);
  }
  @Post('session')
  @UseGuards(JwtAuthGuard)
  session(@Req() req: any, @Body('deviceFingerprint') fingerprint: unknown) {
    return this.authService.session(req.user, fingerprint);
  }
  @Post('logout')
  logout(@Headers('authorization') authorization: string | undefined) {
    return this.authService.logout(authorization);
  }
}
