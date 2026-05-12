import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { TAB_HREF, type TabKey } from '@/lib/tabRoutes';

/** Active tab icon + label (amber). Inactive: white @ 50% opacity. */
const TAB_ACTIVE = '#C97E2F';
const TAB_INACTIVE = 'rgba(255,255,255,0.5)';

type Props = {
  active: 'today' | 'plan' | 'rova' | 'progress' | 'journal' | 'profile';
};

export function FloatingPillNav({ active }: Props) {
  const router = useRouter();
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const navBackground = theme.id === 'obsidianIce' ? theme.surface : theme.primary;
  const isWebDesktop = Platform.OS === 'web' && width > 768;

  if (isWebDesktop) return null;

  const tabs: { key: Props['active']; icon: keyof typeof Ionicons.glyphMap; label: string; tab: TabKey }[] = [
    { key: 'today', icon: 'locate', label: 'Today', tab: 'today' },
    { key: 'plan', icon: 'calendar-clear-outline', label: 'Plan', tab: 'plan' },
    { key: 'progress', icon: 'bar-chart-outline', label: 'Progress', tab: 'progress' },
    { key: 'journal', icon: 'book-outline', label: 'Journal', tab: 'journal' },
    { key: 'profile', icon: 'person-circle-outline', label: 'Profile', tab: 'profile' },
  ];

  return (
    <View style={styles.wrap}>
      <View style={[styles.nav, { backgroundColor: navBackground }]}>
        {tabs.map((tab) => {
          const isActive = active === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={styles.btn}
              onPress={() => {
                if (tab.key !== active) {
                  router.replace(TAB_HREF[tab.tab]);
                }
              }}>
              <View style={styles.tabCluster}>
                <Ionicons name={tab.icon} size={18} color={isActive ? TAB_ACTIVE : TAB_INACTIVE} />
                <Text style={[styles.label, { color: isActive ? TAB_ACTIVE : TAB_INACTIVE }]}>{tab.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
  },
  nav: {
    width: '94%',
    minHeight: 70,
    borderRadius: 24,
    paddingVertical: 4,
    paddingHorizontal: 2,
    backgroundColor: '#0F2840',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 9,
  },
  btn: {
    flex: 1,
    minWidth: 48,
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 0,
  },
  tabCluster: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 2,
    borderRadius: 14,
    backgroundColor: 'transparent',
  },
  label: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 9,
  },
});

