import { Body, Controller, All, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard'; // 기존 me용

@Controller('v1/auth')
export class AuthController {
  prisma: any;
  constructor(private readonly authService: AuthService) {}

  @All('login')
  login(@Body() body: { loginId: string; password: string }) {
    return this.authService.login(body.loginId, body.password);
  }

  @All('refresh')
  refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refresh(body.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @All('me')
  me(@Req() req: any) {
    // ❌ req.user.clan 같은 것 접근 금지
    // ✅ 서비스에 payload 그대로 넘기면, 서비스가 DB에서 clan 정보를 조인해 반환합니다.
    return this.authService.me(req.user);
  }

  @All('logout')
  logout() {
    return this.authService.logout();
  }

  @All('signup')
  async signup(
    @Body() body: { loginId: string; password: string; role?: string },
  ) {
    return this.authService.signup(body.loginId, body.password, body.role);
  }
}