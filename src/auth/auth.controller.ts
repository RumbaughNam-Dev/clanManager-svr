import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard'; // 기존 me용

@Controller('v1/auth')
export class AuthController {
  prisma: any;
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: { loginId: string; password: string }) {
    return this.authService.login(body.loginId, body.password);
  }

  @Post('refresh')
  refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refresh(body.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me')
  me(@Req() req: any) {
    // ❌ req.user.clan 같은 것 접근 금지
    // ✅ 서비스에 payload 그대로 넘기면, 서비스가 DB에서 clan 정보를 조인해 반환합니다.
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