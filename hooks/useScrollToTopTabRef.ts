import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef } from 'react';
import type { ScrollView } from 'react-native';

/** Ref for a tab screen's main vertical ScrollView — snaps to top whenever the tab is focused. */
export function useScrollToTopTabRef() {
  const ref = useRef<ScrollView>(null);

  useFocusEffect(
    useCallback(() => {
      const t = requestAnimationFrame(() => {
        ref.current?.scrollTo({ y: 0, animated: false });
      });
      return () => cancelAnimationFrame(t);
    }, [])
  );

  return ref;
}
