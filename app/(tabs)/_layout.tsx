import { Tabs } from 'expo-router';
import React from 'react';
import { WebLayout } from '@/components/WebLayout';

export default function TabLayout() {
  return (
    <WebLayout>
      <Tabs
        tabBar={() => null}
        screenOptions={{
          animation: 'none',
          headerShown: false,
          tabBarStyle: { display: 'none' },
          sceneStyle: { backgroundColor: 'transparent' },
        }}>
        <Tabs.Screen name="index" options={{ href: '/(tabs)' }} />
        <Tabs.Screen name="plan" options={{ href: '/plan' }} />
        <Tabs.Screen name="intelligence" options={{ href: null }} />
        <Tabs.Screen name="progress" options={{ href: '/progress' }} />
        <Tabs.Screen name="journal" options={{ href: '/journal' }} />
        <Tabs.Screen name="profile" options={{ href: '/profile' }} />
      </Tabs>
    </WebLayout>
  );
}
