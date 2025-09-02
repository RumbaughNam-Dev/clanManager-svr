import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';

@Injectable()
export class RefreshStrategy extends PassportStrategy(Strategy, 'refresh') {
  async validate(req: any) {
    const token = req.body?.refreshToken || req.headers['x-refresh-token'];
    if (!token) throw new UnauthorizedException('refreshToken required');
    return { refreshToken: token };
  }
}