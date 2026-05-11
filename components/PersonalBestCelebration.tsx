import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { withAlpha } from '@/lib/theme-utils';
import { formatMinutesAsMmSs } from '@/services/personalBests';
import { usePersonalBestCelebrationStore } from '@/store/personal-best-celebration-store';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export function PersonalBestCelebration() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const visible = usePersonalBestCelebrationStore((s) => s.visible);
  const payload = usePersonalBestCelebrationStore((s) => s.payload);
  const hide = usePersonalBestCelebrationStore((s) => s.hide);

  const burst = useRef([...Array(12)].map(() => new Animated.Value(0))).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;

  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    if (!visible || !payload) return undefined;

    titleOpacity.setValue(0);
    burst.forEach((v) => v.setValue(0));

    Animated.parallel([
      Animated.timing(titleOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.stagger(
        40,
        burst.map((v) =>
          Animated.sequence([
            Animated.timing(v, { toValue: 1, duration: 520, useNativeDriver: true }),
            Animated.timing(v, { toValue: 0, duration: 400, useNativeDriver: true }),
          ])
        )
      ),
    ]).start();

    const dismissTimer = setTimeout(() => hide(), 3000);
    return () => clearTimeout(dismissTimer);
  }, [visible, payload, burst, titleOpacity, hide]);

  const sparkles = useMemo(() => {
    const cx = SCREEN_W / 2;
    const cy = SCREEN_H * 0.38;
    const radius = Math.min(SCREEN_W, SCREEN_H) * 0.22;
    return burst.map((anim, i) => {
      const angle = (i / burst.length) * Math.PI * 2;
      const tx = cx + Math.cos(angle) * radius - cx;
      const ty = cy + Math.sin(angle) * radius - cy;
      return { anim, tx, ty };
    });
  }, [burst]);

  return (
    <Modal transparent visible={visible && Boolean(payload)} animationType="fade" onRequestClose={hide}>
      <View style={styles.modalFill}>
        <Pressable style={styles.backdropPress} onPress={hide} accessibilityRole="button" />
        <View style={[styles.contentOverlay, { paddingTop: insets.top + 24 }]} pointerEvents="box-none">
          <Animated.View style={[styles.card, { opacity: titleOpacity }]}>
            <Pressable accessibilityRole="button" hitSlop={12} style={styles.closeChip} onPress={hide}>
              <Ionicons name="close" size={18} color={theme.primary} />
            </Pressable>
            <Text style={styles.kicker}>Personal best</Text>
            <Text style={styles.title}>New Personal Best!</Text>
            {payload ? (
              <>
                <Text style={styles.line}>{payload.label}</Text>
                <Text style={styles.time}>{formatMinutesAsMmSs(payload.newTimeMins)}</Text>
              </>
            ) : null}
          </Animated.View>
          <View style={styles.sparkleLayer} pointerEvents="none">
            {sparkles.map(({ anim, tx, ty }, i) => (
              <Animated.View
                key={`sp-${i}`}
                style={{
                  position: 'absolute',
                  left: SCREEN_W / 2 - 6,
                  top: SCREEN_H * 0.38 - 6,
                  opacity: anim,
                  transform: [
                    {
                      translateX: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, tx],
                      }),
                    },
                    {
                      translateY: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, ty],
                      }),
                    },
                    {
                      scale: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.3, 1.2],
                      }),
                    },
                  ],
                }}>
                <Ionicons name="star" size={14} color={theme.accent} />
              </Animated.View>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    modalFill: {
      flex: 1,
    },
    backdropPress: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: withAlpha('#000000', 0.55),
    },
    contentOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      paddingHorizontal: 28,
    },
    card: {
      backgroundColor: theme.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: withAlpha(theme.accent, 0.35),
      paddingVertical: 28,
      paddingHorizontal: 22,
      alignItems: 'center',
      gap: 8,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
      elevation: 12,
    },
    closeChip: {
      position: 'absolute',
      top: 12,
      right: 12,
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
    },
    kicker: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 11,
      letterSpacing: 1,
      color: theme.accent,
      textTransform: 'uppercase',
    },
    title: {
      fontFamily: 'CormorantGaramond_700Bold',
      fontSize: 30,
      color: theme.primary,
      textAlign: 'center',
    },
    line: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 15,
      color: theme.text,
      marginTop: 4,
      textAlign: 'center',
    },
    time: {
      fontFamily: 'DMSans_700Bold',
      fontSize: 28,
      color: theme.accent,
      marginTop: 4,
    },
    sparkleLayer: {
      ...StyleSheet.absoluteFillObject,
    },
  });
