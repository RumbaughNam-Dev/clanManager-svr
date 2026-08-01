import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return { ok: true, service: 'API Server' };
  }
  getHello(): string {
    return 'Hello World!';
  }
}