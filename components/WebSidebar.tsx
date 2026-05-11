import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useActiveAthlete, useRaceGoals } from '@/hooks/useSessionData';
import { daysUntilIsoDate, getPrimaryRaceForPlanning } from '@/services/racePriority';

type RouteItem = {
  label: 'Today' | 'Plan' | 'Progress' | 'Profile';
  route: '/(tabs)' | '/(tabs)/plan' | '/(tabs)/progress' | '/(tabs)/profile';
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
};

export function WebSidebar({ pathname }: { pathname: string }) {
  const router = useRouter();
  const { theme } = useTheme();
  const { data: athlete } = useActiveAthlete();
  const { data: raceGoals = [] } = useRaceGoals(athlete?.id);
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const primaryRace = useMemo(() => getPrimaryRaceForPlanning(raceGoals, todayIso), [raceGoals, todayIso]);
  const level = (athlete?.level ?? 'fara').toString();

  const items: RouteItem[] = [
    {
      label: 'Today',
      route: '/(tabs)',
      icon: 'locate-outline',
      active: pathname === '/(tabs)' || pathname === '/',
    },
    {
      label: 'Plan',
      route: '/(tabs)/plan',
      icon: 'calendar-outline',
      active: pathname.startsWith('/(tabs)/plan'),
    },
    {
      label: 'Progress',
      route: '/(tabs)/progress',
      icon: 'bar-chart-outline',
      active: pathname.startsWith('/(tabs)/progress'),
    },
    {
      label: 'Profile',
      route: '/(tabs)/profile',
      icon: 'person-outline',
      active: pathname.startsWith('/(tabs)/profile') || pathname.includes('/goal-races') || pathname.includes('/template-plan'),
    },
  ];

  return (
    <View style={[styles.root, { backgroundColor: '#0F2840' }]}>
      <View>
        <View style={styles.brandRow}>
          <Text style={[styles.brandText, { color: '#F6F3EE' }]}>telo</Text>
          <View style={[styles.brandDot, { backgroundColor: '#C97E2F' }]} />
        </View>
        <Text style={[styles.athleteName, { color: 'rgba(246,243,238,0.6)' }]} numberOfLines={1}>
          {athlete?.name ?? 'Athlete'}
        </Text>
        <View style={styles.levelBadge}>
          <Text style={styles.levelBadgeText}>{level[0].toUpperCase() + level.slice(1)}</Text>
        </View>
      </View>

      <View style={styles.navList}>
        {items.map((item) => (
          <Pressable
            key={item.label}
            style={[styles.navItem, item.active ? styles.navItemActive : null]}
            onPress={() => router.replace(item.route)}>
            <Ionicons
              name={item.icon}
              size={17}
              color={item.active ? '#F6F3EE' : 'rgba(246,243,238,0.7)'}
            />
            <Text style={[styles.navLabel, item.active ? styles.navLabelActive : null]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.bottomMeta}>
        <Text style={styles.countdownText}>
          {primaryRace ? `D-${Math.max(0, daysUntilIsoDate(primaryRace.event_date, todayIso))}` : 'Set race'}
        </Text>
        <Text style={styles.raceNameText} numberOfLines={2}>
          {primaryRace?.title ?? 'No race goal yet'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 28,
    paddingBottom: 16,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brandText: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 32,
    letterSpacing: 0.2,
  },
  brandDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 8,
  },
  athleteName: {
    marginTop: 8,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
  },
  levelBadge: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#C97E2F',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  levelBadgeText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#C97E2F',
  },
  navList: {
    marginTop: 26,
    gap: 6,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  navItemActive: {
    borderLeftColor: '#C97E2F',
  },
  navLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: 'rgba(246,243,238,0.7)',
  },
  navLabelActive: {
    color: '#F6F3EE',
  },
  bottomMeta: {
    marginTop: 'auto',
  },
  countdownText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#C97E2F',
  },
  raceNameText: {
    marginTop: 4,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: 'rgba(246,243,238,0.4)',
    lineHeight: 15,
  },
});
