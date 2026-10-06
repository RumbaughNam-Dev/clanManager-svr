import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/allblue-client';
import { AllbluePrismaService } from '../allblue-prisma.service';

type DB = Prisma.TransactionClient;
const identitySelect = { id: true, userId: true, nickname: true, userName: true, isTemporary: true,
  temporaryOwnerId: true, temporaryLinkedAt: true, temporaryLinkedToId: true, status: true } as const;
const json = (value: unknown): any => JSON.parse(JSON.stringify(value));
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type LinkChange = { table: string; action: 'update' | 'delete'; id: number; before: any; after: any };

// Return only the dialing prefix and last four digits; never expose the full number.
export function maskLinkPhone(phone?: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('82')) digits = `0${digits.slice(2)}`;
  if (!/^0\d{8,10}$/.test(digits)) return null;
  const prefix = digits.startsWith('02') ? '02' : digits.slice(0, 3);
  return `${prefix}-xxxx-${digits.slice(-4)}`;
}

@Injectable()
export class TemporaryUserLinkService {
  constructor(private prisma: AllbluePrismaService, private config: ConfigService) {}

  private validIds(...ids: number[]) {
    if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new BadRequestException('사용자와 일정을 확인해주세요.');
  }

  private async context(db: DB, scheduleId: number, sourceId: number, actorId: number, allowLinked = false) {
    this.validIds(scheduleId, sourceId, actorId);
    const [actor, source, schedule] = await Promise.all([
      db.user.findUnique({ where: { id: actorId }, select: identitySelect }),
      db.user.findUnique({ where: { id: sourceId }, select: identitySelect }),
      db.schedule.findUnique({ where: { id: scheduleId }, select: { instructorId: true } }),
    ]);
    if (!actor || actor.isTemporary || actor.status !== 'approved' || !source?.isTemporary ||
      source.temporaryOwnerId !== actorId || schedule?.instructorId !== actor.userId) {
      throw new ForbiddenException('이 일정과 임시 사용자를 등록한 사람만 연결할 수 있습니다.');
    }
    if (actor.userId === this.config.get('ALLBLUE_DEMO_USER_ID')) throw new ForbiddenException('공용 데모 계정에서는 사용자 연결을 지원하지 않습니다.');
    if (source.temporaryLinkedAt && !allowLinked) throw new ConflictException('이미 연결된 임시 사용자입니다. 일정을 새로고침해주세요.');
    if (!source.temporaryLinkedAt) {
      const participant = await db.schedule_participant.findFirst({ where: { scheduleId, userId: source.userId, invitationStatus: { not: 'removed' } } });
      if (!participant) throw new ForbiddenException('이 일정에 등록된 임시 사용자가 아닙니다.');
    }
    return { actor, source };
  }

  async targets(scheduleId: number, sourceId: number, actorId: number, query: string) {
    await this.context(this.prisma, scheduleId, sourceId, actorId);
    if (!query?.trim()) return { users: [] };
    const users = await this.prisma.user.findMany({ where: {
      isTemporary: false, status: 'approved', id: { not: actorId },
      ...(this.config.get<string>('ALLBLUE_DEMO_USER_ID') ? { userId: { not: this.config.get<string>('ALLBLUE_DEMO_USER_ID') } } : {}),
      OR: [{ nickname: { contains: query.trim() } }, { userName: { contains: query.trim() } }],
    }, select: { id: true, userId: true, nickname: true, userName: true, profileImage: true, phone: true, profile: { select: { level: true } } }, orderBy: { id: 'asc' }, take: 30 });
    return { users: users.map(u => ({ id: u.id, userId: u.userId, nickname: u.nickname, name: u.userName,
      profileImage: u.profileImage, level: u.profile?.level ?? '0', phoneHint: maskLinkPhone(u.phone) })) };
  }

  private async collect(db: DB, scheduleId: number, sourceId: number, targetId: number, actorId: number) {
    this.validIds(targetId);
    const { actor, source } = await this.context(db, scheduleId, sourceId, actorId);
    const target = await db.user.findUnique({ where: { id: targetId }, select: identitySelect });
    if (!target || target.isTemporary || target.status !== 'approved' || targetId === actorId ||
      target.userId === this.config.get('ALLBLUE_DEMO_USER_ID')) throw new BadRequestException('본인을 제외한 가입 완료 사용자를 선택해주세요.');
    const blocked = await db.blocked_user.findFirst({ where: { OR: [
      { userId: actor.userId, blockedId: target.userId }, { userId: target.userId, blockedId: actor.userId },
    ] } });
    if (blocked) throw new ForbiddenException('차단 관계인 사용자와 연결할 수 없습니다.');
    const strings = [source.userId, target.userId];
    const ids = [sourceId, targetId];
    const [participants, courses, achievements, forms, debriefings, friends, groups, buddies, blocks] = await Promise.all([
      db.schedule_participant.findMany({ where: { userId: { in: strings } }, orderBy: { id: 'asc' } }),
      db.user_license.findMany({ where: { userId: { in: strings } }, orderBy: { id: 'asc' } }),
      db.user_license_achievement.findMany({ where: { userId: { in: ids } }, orderBy: { id: 'asc' } }),
      db.form_submission.findMany({ where: { participantUserId: source.userId }, select: { id: true, uuid: true, participantUserId: true, scheduleId: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } }),
      db.debriefing.findMany({ where: { participantId: sourceId }, select: { id: true, participantId: true, scheduleId: true, createdBy: true, updatedAt: true }, orderBy: { id: 'asc' } }),
      db.close_friend.findMany({ where: { OR: [{ userId: { in: strings } }, { friendId: { in: strings } }] }, orderBy: { id: 'asc' } }),
      db.friend_group_member.findMany({ where: { userId: { in: strings } }, orderBy: { id: 'asc' } }),
      db.dive_buddy.findMany({ where: { OR: [{ userId: { in: strings } }, { buddyId: { in: strings } }] }, orderBy: { id: 'asc' } }),
      db.blocked_user.findMany({ where: { OR: [{ userId: { in: strings } }, { blockedId: { in: strings } }] }, orderBy: { id: 'asc' } }),
    ]);
    const courseLinks = await db.schedule_participant_license.findMany({ where: { OR: [
      { scheduleParticipantId: { in: participants.map(p => p.id) } }, { userLicenseId: { in: courses.map(c => c.id) } },
    ] }, orderBy: { id: 'asc' } });
    const scheduleIds = [...new Set([scheduleId, ...participants.filter(p => p.userId === source.userId).map(p => p.scheduleId),
      ...forms.flatMap(f => f.scheduleId ? [f.scheduleId] : []), ...debriefings.map(d => d.scheduleId)])].sort((a, b) => a - b);
    const schedules = await db.schedule.findMany({ where: { id: { in: scheduleIds } }, select: { id: true, title: true, scheduleDate: true, instructorId: true }, orderBy: { id: 'asc' } });
    // A source identity must never be transferred by someone who does not own its records.
    if (schedules.some(s => s.instructorId !== actor.userId)) throw new ConflictException('다른 등록자의 일정이 연결되어 있어 자동 연결할 수 없습니다.');
    return { actor, source, target, participants, courses, courseLinks, achievements, forms, debriefings, friends, groups, buddies, blocks, schedules, scheduleIds };
  }

  async preview(scheduleId: number, sourceId: number, targetId: number, actorId: number) {
    const data = await this.prisma.$transaction(tx => this.collect(tx, scheduleId, sourceId, targetId, actorId), { isolationLevel: 'RepeatableRead' });
    const plan = buildLinkPlan(data);
    const confirmationToken = jwt.sign({ purpose: 'temporary-user-link', scheduleId, sourceId, targetId, actorId, fingerprint: fingerprint(data) },
      this.config.get<string>('JWT_SECRET', 'dev-allblue-secret'), { expiresIn: '10m' });
    return { source: { id: data.source.id, nickname: data.source.nickname }, target: { id: data.target.id, userId: data.target.userId, nickname: data.target.nickname, name: data.target.userName }, schedules: data.schedules.map(s => ({ id: s.id, title: s.title, date: s.scheduleDate.toISOString().slice(0, 10) })),
      counts: { schedules: data.scheduleIds.length, forms: data.forms.length, debriefings: data.debriefings.length,
        courses: data.courses.filter(c => c.userId === data.source.userId).length,
        achievements: data.achievements.filter(a => a.userId === sourceId).length },
      duplicates: plan.duplicates, confirmationToken };
  }

  async link(scheduleId: number, sourceId: number, targetId: number, actorId: number, confirmationToken: unknown) {
    this.validIds(scheduleId, sourceId, targetId, actorId);
    let confirmed: any;
    try { confirmed = jwt.verify(String(confirmationToken ?? ''), this.config.get<string>('JWT_SECRET', 'dev-allblue-secret')); }
    catch { throw new ConflictException('확인 화면이 만료되었습니다. 연결 내용을 다시 확인해주세요.'); }
    if (confirmed.purpose !== 'temporary-user-link' || confirmed.scheduleId !== scheduleId || confirmed.sourceId !== sourceId ||
      confirmed.targetId !== targetId || confirmed.actorId !== actorId) throw new ForbiddenException('연결 확인 정보가 일치하지 않습니다.');
    try {
      return await this.prisma.$transaction(async tx => {
        const lockIds = [...new Set([sourceId, targetId, actorId])].sort((a, b) => a - b);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM user WHERE id IN (${Prisma.join(lockIds)}) ORDER BY id FOR UPDATE`);
        await this.context(tx, scheduleId, sourceId, actorId, true);
        const existing = await tx.temporary_user_link_audit.findUnique({ where: { sourceId } });
        if (existing) {
          if (existing.actorId !== actorId || existing.targetId !== targetId) throw new ConflictException('다른 사용자에게 이미 연결되었습니다.');
          return { success: true, auditId: existing.id, alreadyLinked: true };
        }
        const data = await this.collect(tx, scheduleId, sourceId, targetId, actorId);
        if (fingerprint(data) !== confirmed.fingerprint) throw new ConflictException('기록이 변경되었습니다. 연결 내용을 다시 확인해주세요.');
        const plan = buildLinkPlan(data);
        const changes: LinkChange[] = [];
        // All updates, deletions and the audit entry commit or roll back together.
        for (const action of plan.actions) {
          const model = (tx as any)[action.table];
          const after = action.action === 'update'
            ? await model.update({ where: { id: action.id }, data: action.data })
            : (await model.delete({ where: { id: action.id } }), null);
          // Only identity metadata for forms/debriefings; no medical content or signatures.
          const recorded = after && action.metadataOnly ? Object.fromEntries(Object.keys(action.before).map(k => [k, after[k]])) : after;
          changes.push({ table: action.table, action: action.action, id: action.id, before: json(action.before), after: json(recorded) });
        }
        const linkedAt = new Date();
        await tx.user.update({ where: { id: sourceId }, data: { temporaryLinkedAt: linkedAt, temporaryLinkedToId: targetId } });
        const audit = await tx.temporary_user_link_audit.create({ data: {
          sourceId, targetId, actorId, sourceUserId: data.source.userId, targetUserId: data.target.userId, actorUserId: data.actor.userId,
          sourceName: data.source.nickname, targetName: data.target.nickname, actorName: data.actor.nickname, originScheduleId: scheduleId,
          details: json({ version: 1, duplicates: plan.duplicates, changes, sourceBefore: data.source,
            sourceAfter: { ...data.source, temporaryLinkedAt: linkedAt, temporaryLinkedToId: targetId } }),
          schedules: { create: data.scheduleIds.map(id => ({ scheduleId: id })) },
        } });
        return { success: true, auditId: audit.id, alreadyLinked: false };
      }, { isolationLevel: 'Serializable', timeout: 30000 });
    } catch (error) {
      const rawLockConflict = error?.code === 'P2010' && ['1020', '1205', '1213'].includes(String(error?.meta?.code));
      if (error?.code === 'P2034' || error?.code === 'P2002' || rawLockConflict) throw new ConflictException('다른 변경이 진행 중입니다. 연결 내용을 다시 확인해주세요.');
      throw error;
    }
  }

  async history(scheduleId: number, actorId: number) {
    this.validIds(scheduleId, actorId);
    const items = await this.prisma.temporary_user_link_audit.findMany({ where: {
      schedules: { some: { scheduleId } }, OR: [{ actorId }, { targetId: actorId }],
    }, orderBy: { id: 'desc' }, take: 100 });
    return { items: items.map(item => ({ ...item, details: publicAuditDetails(item.details,
      item.actorId === actorId ? item.actorUserId : item.targetUserId), createdAt: item.createdAt.toISOString() })) };
  }
}

// The database keeps restoration snapshots. The API exposes record changes only,
// never another person's contact memo, invitation token or private document data.
export function publicAuditDetails(details: any, viewerUserId?: string) {
  const allowed = new Set(['id', 'userId', 'friendId', 'buddyId', 'blockedId', 'groupId', 'scheduleId',
    'participantId', 'participantUserId', 'scheduleParticipantId', 'userLicenseId', 'licenseId', 'requirementId',
    'instructorId', 'createdBy', 'categoryCode', 'invitationStatus', 'respondedAt', 'status', 'isCompleted',
    'completedBy', 'certificateNumber', 'startedAt', 'completedAt', 'lastDiveDate', 'createdAt', 'updatedAt']);
  const safeRow = (row: any) => row == null ? null : Object.fromEntries(Object.entries(row).filter(([key]) => allowed.has(key)));
  return { version: details.version, duplicates: details.duplicates, changes: details.changes.map((change: LinkChange) => {
    const privateRelation = ['close_friend', 'dive_buddy', 'blocked_user', 'friend_group_member'].includes(change.table);
    const ownRelation = change.before?.userId === viewerUserId && change.table !== 'friend_group_member';
    const row = (value: any) => privateRelation && !ownRelation ? (value == null ? null : { id: change.id }) : safeRow(value);
    return { table: change.table, action: change.action, id: change.id, before: row(change.before), after: row(change.after) };
  }) };
}

type LinkData = Awaited<ReturnType<TemporaryUserLinkService['collect']>>;
type Action = { table: string; action: 'update' | 'delete'; id: number; before: any; data?: any; metadataOnly?: boolean };

// Pure deterministic plan, shared by preview/commit and conflict tests.
export function buildLinkPlan(data: LinkData) {
  const { source, target } = data;
  const actions: Action[] = [];
  const update = (table: string, before: any, values: any, metadataOnly = false) => actions.push({ table, action: 'update', id: before.id, before, data: values, metadataOnly });
  const remove = (table: string, before: any) => actions.push({ table, action: 'delete', id: before.id, before });
  const duplicates = { schedules: 0, courses: 0, achievements: 0, contacts: 0 };
  const participantMap = new Map<number, number>();
  const participantDeletes: any[] = [];
  for (const p of data.participants.filter(p => p.userId === source.userId)) {
    const existing = data.participants.find(t => t.userId === target.userId && t.scheduleId === p.scheduleId);
    if (existing) { participantMap.set(p.id, existing.id); participantDeletes.push(p); duplicates.schedules++; }
    else { participantMap.set(p.id, p.id); update('schedule_participant', p, { userId: target.userId, invitationToken: null }); }
  }
  const courseMap = new Map<number, number>();
  const courseDeletes: any[] = [];
  const targetCourses = data.courses.filter(c => c.userId === target.userId).map(c => ({ ...c }));
  for (const c of data.courses.filter(c => c.userId === source.userId)) {
    const existing = targetCourses.find(t => t.licenseId === c.licenseId && t.instructorId === c.instructorId &&
      (!t.certificateNumber || !c.certificateNumber || t.certificateNumber === c.certificateNumber));
    if (!existing) { courseMap.set(c.id, c.id); update('user_license', c, { userId: target.userId }); targetCourses.push({ ...c, userId: target.userId }); continue; }
    duplicates.courses++; courseMap.set(c.id, existing.id); courseDeletes.push(c);
    const values = {
      status: existing.status === 'COMPLETED' || c.status === 'COMPLETED' ? 'COMPLETED' : existing.status,
      certificateNumber: existing.certificateNumber || c.certificateNumber,
      startedAt: !existing.startedAt || (c.startedAt && c.startedAt < existing.startedAt) ? c.startedAt : existing.startedAt,
      completedAt: existing.completedAt ?? c.completedAt,
    };
    update('user_license', { ...existing }, values); Object.assign(existing, values);
  }
  const mappedLinks = data.courseLinks.map(before => {
    const scheduleParticipantId = participantMap.get(before.scheduleParticipantId) ?? before.scheduleParticipantId;
    const userLicenseId = courseMap.get(before.userLicenseId) ?? before.userLicenseId;
    return { before, scheduleParticipantId, userLicenseId,
      changed: scheduleParticipantId !== before.scheduleParticipantId || userLicenseId !== before.userLicenseId };
  }).sort((a, b) => Number(a.changed) - Number(b.changed));
  const seenLinks = new Set<string>();
  const linkUpdates: typeof mappedLinks = [];
  // Keep rows whose actual keys stay unchanged, even when their course/user moves.
  // Delete colliding rows before updating any unique composite key.
  for (const l of mappedLinks) {
    const key = `${l.scheduleParticipantId}:${l.userLicenseId}`;
    if (seenLinks.has(key)) remove('schedule_participant_license', l.before);
    else { seenLinks.add(key); if (l.changed) linkUpdates.push(l); }
  }
  linkUpdates.forEach(l => update('schedule_participant_license', l.before,
    { scheduleParticipantId: l.scheduleParticipantId, userLicenseId: l.userLicenseId }));
  participantDeletes.forEach(p => remove('schedule_participant', p));
  courseDeletes.forEach(c => remove('user_license', c));
  for (const a of data.achievements.filter(a => a.userId === source.id)) {
    const existing = data.achievements.find(t => t.userId === target.id && t.requirementId === a.requirementId);
    if (!existing) update('user_license_achievement', a, { userId: target.id });
    else {
      duplicates.achievements++;
      if (existing.isCompleted !== 1 && a.isCompleted === 1) update('user_license_achievement', existing, { isCompleted: 1, completedAt: a.completedAt, completedBy: a.completedBy });
      remove('user_license_achievement', a);
    }
  }
  data.forms.forEach(f => update('form_submission', f, { participantUserId: target.userId }, true));
  data.debriefings.forEach(d => update('debriefing', d, { participantId: target.id }, true));
  const replace = (id: string) => id === source.userId ? target.userId : id;
  for (const [table, rows, keys] of [
    ['close_friend', data.friends, ['userId', 'friendId']],
    ['dive_buddy', data.buddies, ['userId', 'buddyId']],
    ['blocked_user', data.blocks, ['userId', 'blockedId']],
    ['friend_group_member', data.groups, ['groupId', 'userId']],
  ] as const) {
    const moving = (row: any) => keys.some(k => row[k] === source.userId);
    const targets = new Map<string, any>(rows.filter(r => !moving(r)).map(r => [keys.map(k => r[k]).join(':'), { ...r }]));
    for (const row of rows.filter(moving)) {
      const values = Object.fromEntries(keys.map(k => [k, typeof row[k] === 'string' ? replace(row[k]) : row[k]]));
      const key = keys.map(k => values[k]).join(':');
      if (keys[0] === 'userId' && values[keys[0]] === values[keys[1]]) { remove(table, row); continue; }
      const existing = targets.get(key);
      if (!existing) { update(table, row, values); targets.set(key, { ...row, ...values }); }
      else {
        duplicates.contacts++;
        if (table === 'dive_buddy' && (row as any).lastDiveDate > existing.lastDiveDate) {
          const patch = { lastDiveDate: (row as any).lastDiveDate, scheduleId: (row as any).scheduleId };
          update(table, { ...existing }, patch); Object.assign(existing, patch);
        }
        if (table === 'close_friend') {
          const sourceMemo = (row as any).memo;
          const memo = existing.memo && sourceMemo && existing.memo !== sourceMemo ? `${existing.memo}\n${sourceMemo}` : existing.memo || sourceMemo;
          const patch = { pinned: Math.max(existing.pinned, (row as any).pinned), memo: memo.length <= 200 ? memo : existing.memo };
          update(table, { ...existing }, patch); Object.assign(existing, patch);
        }
        remove(table, row);
      }
    }
  }
  return { actions, duplicates };
}
