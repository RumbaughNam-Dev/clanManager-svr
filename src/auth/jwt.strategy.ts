import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET', 'dev-access'),
    });
  }

  async validate(payload: any) {
    // 가드 통과 후 req.user 에 들어감
    return {
      sub: String(payload.sub),
      role: payload.role,
      loginId: payload.loginId,
      clanId: payload.clanId ?? null,
    };
  }
}