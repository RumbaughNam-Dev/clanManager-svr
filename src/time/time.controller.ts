import { Controller, Post } from '@nestjs/common';

@Controller('v1/time')
export class TimeController {
  @Post('now')
  now() {
    const now = new Date();
    return {
      // ISO 그대로 내려주고 싶다면 그대로
      nowIso: now.toISOString(),
      // KST 보정된 문자열
      nowKst: now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
    };
  }
}