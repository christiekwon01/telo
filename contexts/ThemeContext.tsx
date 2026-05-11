import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readableTextColor } from '@/lib/theme-utils';

export const SELECTED_THEME_STORAGE_KEY = 'selectedTheme';

export type ThemeId = 'navyAmber' | 'burgundyChampagne' | 'obsidianIce' | 'slateCitrus';

export type AppTheme = {
  id: ThemeId;
  name: string;
  base: string;
  primary: string;
  accent: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  danger: string;
  onPrimary: string;
  onAccent: string;
  onSurface: string;
};

export const THEME_OPTIONS: AppTheme[] = [
  {
    id: 'navyAmber',
    name: 'Navy + Amber',
    base: '#F6F3EE',
    primary: '#0F2840',
    accent: '#C97E2F',
    surface: '#FFFFFF',
    text: '#0F2840',
    textMuted: 'rgba(15,40,64,0.6)',
    border: 'rgba(15,40,64,0.12)',
    danger: '#C2413B',
    onPrimary: readableTextColor('#0F2840'),
    onAccent: readableTextColor('#C97E2F'),
    onSurface: readableTextColor('#FFFFFF'),
  },
  {
    id: 'burgundyChampagne',
    name: 'Burgundy + Champagne',
    base: '#FAF3F1',
    primary: '#5A1E33',
    accent: '#D6B27D',
    surface: '#FFFDFC',
    text: '#4A192B',
    textMuted: 'rgba(90,30,51,0.62)',
    border: 'rgba(90,30,51,0.14)',
    danger: '#C2413B',
    onPrimary: readableTextColor('#5A1E33'),
    onAccent: readableTextColor('#D6B27D'),
    onSurface: readableTextColor('#FFFDFC'),
  },
  {
    id: 'obsidianIce',
    name: 'Obsidian + Ice',
    base: '#0E1217',
    primary: '#DCEBFF',
    accent: '#7CC7FF',
    surface: '#171D25',
    text: '#EAF3FF',
    textMuted: 'rgba(220,235,255,0.7)',
    border: 'rgba(220,235,255,0.18)',
    danger: '#FF7D7D',
    onPrimary: readableTextColor('#DCEBFF'),
    onAccent: readableTextColor('#7CC7FF'),
    onSurface: readableTextColor('#171D25'),
  },
  {
    id: 'slateCitrus',
    name: 'Slate + Citrus',
    base: '#EEF2F3',
    primary: '#2B4452',
    accent: '#9CCB3B',
    surface: '#FFFFFF',
    text: '#243842',
    textMuted: 'rgba(43,68,82,0.62)',
    border: 'rgba(43,68,82,0.14)',
    danger: '#C2413B',
    onPrimary: readableTextColor('#2B4452'),
    onAccent: readableTextColor('#9CCB3B'),
    onSurface: readableTextColor('#FFFFFF'),
  },
];

type ThemeContextValue = {
  theme: AppTheme;
  themes: AppTheme[];
  isHydrated: boolean;
  setThemeById: (themeId: ThemeId) => Promise<void>;
};

const defaultTheme = THEME_OPTIONS[0];

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<AppTheme>(defaultTheme);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const hydrateTheme = async () => {
      try {
        const storedThemeId = await AsyncStorage.getItem(SELECTED_THEME_STORAGE_KEY);
        const storedTheme = THEME_OPTIONS.find((option) => option.id === storedThemeId);
        if (storedTheme) {
          setTheme(storedTheme);
        }
      } catch {
        /* AsyncStorage can fail on simulator / low disk; keep default theme */
      } finally {
        setIsHydrated(true);
      }
    };
    void hydrateTheme();
  }, []);

  const setThemeById = async (themeId: ThemeId) => {
    const nextTheme = THEME_OPTIONS.find((option) => option.id === themeId);
    if (!nextTheme) return;
    setTheme(nextTheme);
    try {
      await AsyncStorage.setItem(SELECTED_THEME_STORAGE_KEY, themeId);
    } catch {
      /* theme still applied in memory */
    }
  };

  const value = useMemo(
    () => ({
      theme,
      themes: THEME_OPTIONS,
      isHydrated,
      setThemeById,
    }),
    [theme, isHydrated]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
