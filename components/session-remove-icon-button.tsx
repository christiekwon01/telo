import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

type SessionRemoveIconButtonProps = {
  onPress: () => void;
  iconColor: string;
  /** Ionicons "close" size; default reads as a small × in session rows */
  size?: number;
  accessibilityLabel?: string;
};

/**
 * Small dismiss control for planned session rows (Plan week, calendar strip, Journal, Today).
 * Kept presentation-only; parent owns confirmation + delete.
 */
export function SessionRemoveIconButton({
  onPress,
  iconColor,
  size = 15,
  accessibilityLabel = 'Remove session',
}: SessionRemoveIconButtonProps) {
  return (
    <View style={styles.hitWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={10}
        style={styles.pressable}
        onPress={onPress}>
        <Ionicons name="close" size={size} color={iconColor} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hitWrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressable: {
    minWidth: 26,
    minHeight: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
