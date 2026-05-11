import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { withAlpha } from '@/lib/theme-utils';

export type TabHeaderProps = {
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
  paddingHorizontal?: number;
  paddingBottom?: number;
};

export function TabHeader({
  title,
  subtitle,
  right,
  paddingHorizontal = 16,
  paddingBottom = 10,
}: TabHeaderProps) {
  const { theme } = useTheme();
  return (
    <View style={[styles.root, { paddingHorizontal, paddingBottom }]}>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: theme.primary }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: withAlpha(theme.primary, 0.6) }]}>{subtitle}</Text>
          ) : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 36,
    lineHeight: 40,
  },
  subtitle: {
    marginTop: 2,
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    paddingTop: 6,
  },
});

