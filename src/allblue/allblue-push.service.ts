import { Injectable } from '@nestjs/common';
import { AllbluePrismaService } from '../allblue-prisma.service';

interface PushMessage {
  to: string;
  title: string;
  body: string;
  sound: string;
  data?: Record<string, any>;
}

interface PushOptions {
  title: string;
  body: string;
  userIds?: string[];
  levels?: string[];
  data?: Record<string, any>;
}

@Injectable()
export class AllbluePushService {
  constructor(private prisma: AllbluePrismaService) {}

  async sendPushNotifications(options: PushOptions): Promise<{ success: boolean; error?: string }> {
    const { title, body, userIds = [], levels = [], data } = options;

    if (userIds.length === 0 && levels.length === 0) {
      return { success: false, error: 'NO_RECIPIENTS' };
    }

    try {
      const allUserIds = new Set<string>(userIds);

      if (levels.length > 0) {
        const levelUsers = await this.prisma.user_profile.findMany({
          where: { level: { in: levels } },
          select: { user: { select: { userId: true } } },
        });
        for (const lu of levelUsers) {
          allUserIds.add(lu.user.userId);
        }
      }

      if (allUserIds.size === 0) {
        return { success: false, error: 'NO_RECIPIENTS' };
      }

      const tokens = await this.prisma.push_token.findMany({
        where: { userId: { in: [...allUserIds] } },
        select: { token: true, userId: true },
      });

      if (tokens.length === 0) {
        return { success: false, error: 'NO_TOKENS' };
      }

      const messages: PushMessage[] = tokens.map(t => ({
        to: t.token,
        title,
        body,
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

      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[Push] 발송 실패:', err);
      return { success: false, error: errorMsg };
    }
  }
}
