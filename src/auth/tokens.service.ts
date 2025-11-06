import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';


@Injectable()
export class TokensService {
  private accessSecret: string;
  private refreshSecret: string;
  private accessExpiresIn: string;
  private refreshExpiresIn: string;

  constructor(private config: ConfigService) {
    this.accessSecret   = this.config.get<string>('JWT_ACCESS_SECRET', 'dev-access');
    this.refreshSecret  = this.config.get<string>('JWT_REFRESH_SECRET', 'dev-refresh');
    this.accessExpiresIn  = this.config.get<string>('JWT_ACCESS_EXPIRES', '1h');
    this.refreshExpiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES', '30d');

    if (process.env.NODE_ENV !== 'production') {
      // 디버깅용: 앞 몇 글자만
      console.log('[JWT cfg] accessSecret:', this.accessSecret.slice(0,6), '..., exp:', this.accessExpiresIn);
    }
    console.log('[JWT:sign] accessSecret=', this.accessSecret.slice(0,6), ' exp=', this.accessExpiresIn);
  }

  signAccess(payload: any) {
    return jwt.sign(
      payload,
      this.accessSecret as Secret,
      { expiresIn: this.accessExpiresIn as unknown as SignOptions['expiresIn'] }
    );
  }
  signRefresh(payload: any) {
    return jwt.sign(
      payload,
      this.refreshSecret as Secret,
      { expiresIn: this.refreshExpiresIn as unknown as SignOptions['expiresIn'] }
    );
  }
  verifyAccess(token: string) {
    return jwt.verify(token, this.accessSecret);
  }
  verifyRefresh(token: string) {
    return jwt.verify(token, this.refreshSecret);
  }
}