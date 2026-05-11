import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

type SkeletonBlockProps = {
  style?: StyleProp<ViewStyle>;
};

export function SkeletonBlock({ style }: SkeletonBlockProps) {
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.9,
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[styles.skeletonBlock, { opacity }, style]} />;
}

type FadeInValueProps = {
  value: string;
  style?: StyleProp<TextStyle>;
};

export function FadeInValue({ value, style }: FadeInValueProps) {
  const opacity = useRef(new Animated.Value(0.65)).current;

  useEffect(() => {
    opacity.setValue(0.65);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [opacity, value]);

  return <Animated.Text style={[style, { opacity }]}>{value}</Animated.Text>;
}

const styles = StyleSheet.create({
  skeletonBlock: {
    borderRadius: 10,
    backgroundColor: 'rgba(15,40,64,0.12)',
  },
});
