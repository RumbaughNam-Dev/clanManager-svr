// src/auth/auth.controller.ts
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: { loginId: string; password: string }) {
    // 서비스에서 mustChangePassword 여부까지 리턴
    return this.authService.login(body.loginId, body.password);
  }

  // ✅ 추가
  @Post('change-password')
  changePassword(@Body() body: { loginId: string; oldPassword: string; newPassword: string }) {
    return this.authService.changePassword(body.loginId, body.oldPassword, body.newPassword);
  }


  @Post('refresh')
  refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refresh(body.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me')
  me(@Req() req: any) {
    return this.authService.me(req.user);
  }

  @Post('logout')
  logout() {
    return this.authService.logout();
  }

  @Post('signup')
  async signup(
    @Body() body: { loginId: string; password: string; role?: string },
  ) {
    return this.authService.signup(body.loginId, body.password, body.role);
  }
}