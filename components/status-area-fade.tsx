import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { withAlpha } from '@/lib/theme-utils';

const STATUS_FADE_LOCATIONS = [0, 0.24, 0.5, 0.76, 1] as const;
const COMPACT_HEADER_LOCATIONS = [0, 0.32, 0.58, 0.82, 1] as const;

export type StatusAreaFadeProps = {
  height: number;
  style?: StyleProp<ViewStyle>;
  zIndex?: number;
};

export function StatusAreaFade({ height, style, zIndex = 5 }: StatusAreaFadeProps) {
  const { theme } = useTheme();
  const statusFadeColors = [
    withAlpha(theme.base, 0.72),
    withAlpha(theme.base, 0.44),
    withAlpha(theme.base, 0.2),
    withAlpha(theme.base, 0.06),
    withAlpha(theme.base, 0),
  ] as const;
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[...statusFadeColors]}
      locations={[...STATUS_FADE_LOCATIONS]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[styles.statusFilm, { height, zIndex }, style]}
    />
  );
}

export type CompactHeaderGradientProps = {
  paddingTop: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  zIndex?: number;
};

export function CompactHeaderGradient({ paddingTop, children, style, zIndex = 6 }: CompactHeaderGradientProps) {
  const { theme } = useTheme();
  const compactHeaderColors = [
    withAlpha(theme.base, 0.88),
    withAlpha(theme.base, 0.52),
    withAlpha(theme.base, 0.22),
    withAlpha(theme.primary, 0.06),
    withAlpha(theme.base, 0),
  ] as const;
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[...compactHeaderColors]}
      locations={[...COMPACT_HEADER_LOCATIONS]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[styles.compactHeader, { paddingTop, zIndex }, style]}>
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  statusFilm: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  compactHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 8,
    shadowColor: '#0F2840',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
});
