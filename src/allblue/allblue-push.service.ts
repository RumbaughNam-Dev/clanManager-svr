import { Injectable } from '@nestjs/common';
import { AllbluePrismaService } from '../allblue-prisma.service';

interface PushMessage {
  to: string;
  title: string;
  body: string;
  sound: string;
  data?: Record<string, any>;
}

@Injectable()
export class AllbluePushService {
  constructor(private prisma: AllbluePrismaService) {}

  async sendPushNotifications(
    userIds: string[],
    title: string,
    body: string | ((userId: string) => string),
    data?: Record<string, any>,
  ) {
    if (userIds.length === 0) return;

    try {
      const tokens = await this.prisma.push_token.findMany({
        where: { userId: { in: userIds } },
        select: { token: true, userId: true },
      });

      if (tokens.length === 0) return;

      const messages: PushMessage[] = tokens.map(t => ({
        to: t.token,
        title,
        body: typeof body === 'function' ? body(t.userId) : body,
        sound: 'default',
        ...(data && { data }),
      }));

      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });

      const result = await response.json();

      // 잘못된 토큰 삭제
      if (result.data && Array.isArray(result.data)) {
        const invalidTokens: string[] = [];
        result.data.forEach((r: any, i: number) => {
          if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(messages[i].to);
          }
        });
        if (invalidTokens.length > 0) {
          await this.prisma.push_token.deleteMany({
            where: { token: { in: invalidTokens } },
          });
        }
      }
    } catch (err) {
      console.error('[Push] 발송 실패:', err);
    }
  }
}
