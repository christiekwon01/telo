/**
 * Expo static export exposes both clean paths (e.g. /journal) and grouped paths (/(tabs)/journal).
 * Use clean hrefs for navigation; match both forms for active states (especially on web).
 */

export const TAB_HREF = {
  today: '/(tabs)',
  plan: '/plan',
  progress: '/progress',
  journal: '/journal',
  profile: '/profile',
} as const;

export type TabKey = keyof typeof TAB_HREF;

export function tabPathIsActive(pathname: string, tab: TabKey): boolean {
  const p = pathname.split('?')[0] ?? pathname;
  switch (tab) {
    case 'today':
      return p === '/' || p === '/(tabs)' || p === '/(tabs)/';
    case 'plan':
      return p === '/plan' || p === '/(tabs)/plan' || p.startsWith('/plan/');
    case 'progress':
      return p === '/progress' || p === '/(tabs)/progress' || p.startsWith('/progress/');
    case 'journal':
      return p === '/journal' || p === '/(tabs)/journal';
    case 'profile':
      return (
        p === '/profile' ||
        p === '/(tabs)/profile' ||
        p.includes('/goal-races') ||
        p.includes('/template-plan')
      );
    default:
      return false;
  }
}
