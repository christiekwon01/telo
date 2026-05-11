import { usePathname } from 'expo-router';
import { ReactNode, useMemo } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { WebSidebar } from '@/components/WebSidebar';

export function WebLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { width } = useWindowDimensions();

  const isWeb = Platform.OS === 'web';
  const isDesktop = isWeb && width > 768;
  const isEmbedded = useMemo(() => {
    if (!isWeb || typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('embed') === 'true';
  }, [isWeb]);

  if (!isDesktop || isEmbedded) {
    return <>{children}</>;
  }

  return (
    <View style={styles.webRoot}>
      <View style={styles.appShell}>
        <View style={styles.sidebarWrap}>
          <WebSidebar pathname={pathname} />
        </View>
        <View style={styles.contentWrap}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  webRoot: {
    flex: 1,
    backgroundColor: '#F6F3EE',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  appShell: {
    flex: 1,
    width: '100%',
    maxWidth: 1240,
    flexDirection: 'row',
  },
  sidebarWrap: {
    width: 240,
    minWidth: 240,
    maxWidth: 240,
  },
  contentWrap: {
    flex: 1,
    backgroundColor: '#F6F3EE',
  },
});
