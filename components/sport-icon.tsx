import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View } from 'react-native';
import type { SportType } from '@/hooks/useSessionData';

type SportIconProps = {
  sport: string;
  size?: number;
  color?: string;
};

function normalizeSport(value: string): SportType {
  if (value === 'swim' || value === 'bike' || value === 'run' || value === 'brick' || value === 'gym') {
    return value;
  }
  return 'rest';
}

export function getSportIcon(sport: string, size = 16, color = '#FFFFFF') {
  const normalized = normalizeSport(sport);
  if (normalized === 'swim') return <MaterialCommunityIcons name="waves" size={size} color={color} />;
  if (normalized === 'bike') return <MaterialCommunityIcons name="bike" size={size} color={color} />;
  if (normalized === 'run') return <MaterialCommunityIcons name="run" size={size} color={color} />;
  if (normalized === 'gym') return <MaterialCommunityIcons name="dumbbell" size={size} color={color} />;
  if (normalized === 'rest') return <MaterialCommunityIcons name="calendar-remove-outline" size={size} color={color} />;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
      <MaterialCommunityIcons name="bike-fast" size={size - 2} color={color} />
      <MaterialCommunityIcons name="run-fast" size={size - 4} color={color} />
    </View>
  );
}

export function SportIcon({ sport, size = 16, color = '#FFFFFF' }: SportIconProps) {
  return getSportIcon(sport, size, color);
}
