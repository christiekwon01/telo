/* eslint-disable import/no-duplicates -- RNGH needs a side-effect import plus GestureHandlerRootView from the same package */
import React, { Component, ReactNode, useEffect, useRef } from 'react';
import 'react-native-gesture-handler';
import { DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import {
  CormorantGaramond_600SemiBold,
  CormorantGaramond_700Bold,
} from '@expo-google-fonts/cormorant-garamond';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  DMSans_800ExtraBold,
} from '@expo-google-fonts/dm-sans';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Text, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { PersonalBestCelebration } from '@/components/PersonalBestCelebration';
import { supabase } from '@/lib/supabase';
import { triggerHuaweiAutoSyncIfNeeded, wireHuaweiAutoSyncOnAppOpen } from '@/services/huaweiHealthSync';

const queryClient = new QueryClient();

type RootErrorBoundaryState = {
  error: Error | null;
};

class RootErrorBoundary extends Component<{ children: ReactNode }, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#F6F3EE' }}>
          <Text style={{ color: '#0F2840', fontSize: 14, textAlign: 'center' }}>
            Error: {this.state.error.message}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    CormorantGaramond_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    DMSans_800ExtraBold,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RootNavigator />
        </ThemeProvider>
      </QueryClientProvider>
    </RootErrorBoundary>
  );
}

function RootNavigator() {
  const { theme } = useTheme();
  const athleteIdRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadAthlete = async () => {
      await supabase.auth.getSession();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!mounted) return;
      athleteIdRef.current = session?.user?.id ?? null;
      if (athleteIdRef.current) {
        void triggerHuaweiAutoSyncIfNeeded(athleteIdRef.current);
      }
    };
    void loadAthlete();

    const detach = wireHuaweiAutoSyncOnAppOpen(() => athleteIdRef.current);
    return () => {
      mounted = false;
      detach();
    };
  }, []);

  const navigationTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: theme.base,
      card: theme.surface,
      text: theme.text,
      border: theme.border,
      primary: theme.primary,
    },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationThemeProvider value={navigationTheme}>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding/index" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="SessionDetail" options={{ headerShown: false }} />
          <Stack.Screen name="goal-races" options={{ headerShown: false }} />
          <Stack.Screen name="template-plan" options={{ headerShown: false }} />
          <Stack.Screen name="apple-calendar" options={{ headerShown: false }} />
          <Stack.Screen name="huawei-health" options={{ headerShown: false }} />
          <Stack.Screen name="progress-history" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <PersonalBestCelebration />
        <StatusBar style="auto" />
      </NavigationThemeProvider>
    </GestureHandlerRootView>
  );
}
