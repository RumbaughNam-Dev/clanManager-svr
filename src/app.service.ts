import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return { ok: true, service: 'Clan Manager API' };
  }
  getHello(): string {
    return 'Hello World!';
  }
}