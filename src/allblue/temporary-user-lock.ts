import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/allblue-client';

// Writers to a temporary identity take the same row lock as the linking transaction.
export async function lockTemporaryUser(tx: any, where: { id: number } | { userId: string }) {
  const found = await tx.user.findUnique({ where, select: { id: true, isTemporary: true } });
  if (!found?.isTemporary) return;
  const clause = 'id' in where ? Prisma.sql`id = ${where.id}` : Prisma.sql`userId = ${where.userId}`;
  const rows: any[] = await tx.$queryRaw(Prisma.sql`SELECT temporary_linked_at FROM user WHERE ${clause} FOR UPDATE`);
  if (rows[0]?.temporary_linked_at) throw new ConflictException('이미 정식 사용자와 연결되었습니다. 새로고침해주세요.');
}
