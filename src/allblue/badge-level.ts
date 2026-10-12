// Keep the authorization level ('A') separate from the qualification shown in UI.
export const BADGE_PROFILE_SELECT = {
  level: true,
  user: { select: { licenses: {
    where: { status: 'COMPLETED' },
    select: { license: { select: { levelOrder: true, isInstructor: true } } },
  } } },
} as const;

type Qualification = { license: { levelOrder: number; isInstructor: number | boolean } };
export function badgeLevel(profile?: { level?: string | number | null; user?: { licenses: Qualification[] } } | null, licenses?: Qualification[]): string {
  if (String(profile?.level).toUpperCase() !== 'A') return String(profile?.level ?? '0');
  return String((licenses ?? profile?.user?.licenses ?? []).reduce((highest, { license }) => {
    const level = license.isInstructor ? 5 : Number(license.levelOrder);
    return Number.isInteger(level) && level >= 1 && level <= 5 ? Math.max(highest, level) : highest;
  }, 0));
}
