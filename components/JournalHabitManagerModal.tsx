import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { useArchiveHabitMutation, useCreateHabitMutation, useJournalHabits } from '@/hooks/useJournalAndHabits';
import { withAlpha } from '@/lib/theme-utils';

type Props = {
  visible: boolean;
  onClose: () => void;
  athleteId: string;
};

export function JournalHabitManagerModal({ visible, onClose, athleteId }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { data: habits = [], refetch } = useJournalHabits(athleteId);
  const createHabit = useCreateHabitMutation(athleteId);
  const archiveHabit = useArchiveHabitMutation(athleteId);

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('✨');

  const onAdd = useCallback(async () => {
    const n = name.trim();
    if (!n) {
      Alert.alert('Name required', 'Give your habit a short name.');
      return;
    }
    try {
      await createHabit.mutateAsync({ name: n, icon_emoji: emoji.trim() || '✓' });
      setName('');
      setEmoji('✨');
      await refetch();
    } catch (e) {
      Alert.alert('Could not add habit', e instanceof Error ? e.message : 'Unknown error');
    }
  }, [createHabit, emoji, name, refetch]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.close}>Done</Text>
          </Pressable>
          <Text style={styles.title}>Habits</Text>
          <View style={{ width: 48 }} />
        </View>
        <Text style={styles.sub}>Keep 5–7 habits for less scroll fatigue. Tap trash to remove.</Text>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {habits.map((h) => (
            <View key={h.id} style={styles.row}>
              <Text style={styles.emoji}>{h.icon_emoji}</Text>
              <Text style={styles.habitName}>{h.name}</Text>
              <Pressable
                onPress={() => {
                  Alert.alert('Remove habit?', `"${h.name}" will disappear from your list.`, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () => {
                        void archiveHabit.mutateAsync(h.id).then(() => refetch());
                      },
                    },
                  ]);
                }}
                hitSlop={8}>
                <Ionicons name="trash-outline" size={18} color={theme.danger} />
              </Pressable>
            </View>
          ))}

          <Text style={styles.addLabel}>New habit</Text>
          <View style={styles.addRow}>
            <TextInput
              style={styles.emojiInput}
              value={emoji}
              onChangeText={setEmoji}
              maxLength={4}
              placeholder="💧"
            />
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="Name"
              placeholderTextColor={theme.textMuted}
            />
          </View>
          <Pressable style={styles.addBtn} onPress={() => void onAdd()} disabled={createHabit.isPending}>
            <Text style={styles.addBtnText}>{createHabit.isPending ? 'Adding…' : 'Add habit'}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>['theme']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.base },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    close: { fontFamily: 'DMSans_500Medium', fontSize: 16, color: theme.accent },
    title: { fontFamily: 'CormorantGaramond_700Bold', fontSize: 22, color: theme.text },
    sub: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: theme.textMuted, paddingHorizontal: 16, marginBottom: 12 },
    scroll: { paddingHorizontal: 16, paddingBottom: 24 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    emoji: { fontSize: 20, width: 36 },
    habitName: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 15, color: theme.text },
    addLabel: {
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 11,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: theme.accent,
      marginTop: 20,
      marginBottom: 8,
    },
    addRow: { flexDirection: 'row', gap: 10 },
    emojiInput: {
      width: 52,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.14),
      textAlign: 'center',
      fontSize: 20,
      paddingVertical: 10,
      backgroundColor: theme.surface,
    },
    nameInput: {
      flex: 1,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.14),
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontFamily: 'DMSans_400Regular',
      fontSize: 15,
      color: theme.text,
      backgroundColor: theme.surface,
    },
    addBtn: {
      marginTop: 12,
      alignSelf: 'flex-start',
      backgroundColor: theme.primary,
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderRadius: 999,
    },
    addBtnText: { fontFamily: 'DMSans_600SemiBold', fontSize: 14, color: theme.onPrimary },
  });
}
