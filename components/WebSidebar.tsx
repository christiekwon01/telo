import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useActiveAthlete, useRaceGoals } from '@/hooks/useSessionData';
import { withAlpha } from '@/lib/theme-utils';
import { TAB_HREF, tabPathIsActive, type TabKey } from '@/lib/tabRoutes';
import { daysUntilIsoDate, getPrimaryRaceForPlanning } from '@/services/racePriority';

type RouteItem = {
  label: 'Today' | 'Plan' | 'Progress' | 'Journal' | 'Profile';
  tab: TabKey;
  icon: keyof typeof Ionicons.glyphMap;
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
    { label: 'Today', tab: 'today', icon: 'locate-outline' },
    { label: 'Plan', tab: 'plan', icon: 'calendar-outline' },
    { label: 'Progress', tab: 'progress', icon: 'bar-chart-outline' },
    { label: 'Journal', tab: 'journal', icon: 'book-outline' },
    { label: 'Profile', tab: 'profile', icon: 'person-outline' },
  ];

  return (
    <View style={[styles.root, { backgroundColor: theme.primary }]}>
      <View>
        <View style={styles.brandRow}>
          <Text style={[styles.brandText, { color: theme.onPrimary }]}>telo</Text>
          <View style={[styles.brandDot, { backgroundColor: theme.accent }]} />
          <Text style={[styles.athleteName, { color: withAlpha(theme.onPrimary, 0.62) }]} numberOfLines={1}>
            {athlete?.name ?? 'Athlete'}
          </Text>
        </View>
        <View style={styles.levelMetaRow}>
          <View style={[styles.levelBadge, { borderColor: theme.accent }]}>
            <Text style={[styles.levelBadgeText, { color: theme.accent }]}>{level[0].toUpperCase() + level.slice(1)}</Text>
          </View>
          <View style={styles.raceMetaInline}>
            <Text style={[styles.countdownText, { color: theme.accent }]}>
              {primaryRace ? `D-${Math.max(0, daysUntilIsoDate(primaryRace.event_date, todayIso))}` : 'Set race'}
            </Text>
            {primaryRace?.title ? (
              <>
                <View style={[styles.centerDot, { backgroundColor: withAlpha(theme.onPrimary, 0.45) }]} />
                <Text style={[styles.raceNameInline, { color: withAlpha(theme.onPrimary, 0.45) }]} numberOfLines={1}>
                  {primaryRace.title}
                </Text>
              </>
            ) : null}
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.navScroll}
        contentContainerStyle={styles.navList}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {items.map((item) => {
          const active = tabPathIsActive(pathname, item.tab);
          return (
            <Pressable
              key={item.label}
              style={[styles.navItem, active ? [styles.navItemActive, { borderLeftColor: theme.accent }] : null]}
              onPress={() => router.replace(TAB_HREF[item.tab])}>
              <Ionicons
                name={item.icon}
                size={17}
                color={active ? theme.onPrimary : withAlpha(theme.onPrimary, 0.7)}
              />
              <Text
                style={[
                  styles.navLabel,
                  { color: withAlpha(theme.onPrimary, 0.7) },
                  active ? [styles.navLabelActive, { color: theme.onPrimary }] : null,
                ]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'column',
    paddingHorizontal: 18,
    paddingTop: 28,
    paddingBottom: 16,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
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
  },
  athleteName: {
    flex: 1,
    minWidth: 0,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
  },
  levelMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  levelBadge: {
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
  raceMetaInline: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: 6,
  },
  navScroll: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    marginTop: 26,
  },
  navList: {
    flexGrow: 1,
    gap: 6,
    paddingBottom: 12,
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
  countdownText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#C97E2F',
  },
  centerDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  raceNameInline: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: 'rgba(246,243,238,0.4)',
    flexShrink: 1,
  },
});
