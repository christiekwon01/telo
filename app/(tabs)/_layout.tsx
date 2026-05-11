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
        <Tabs.Screen name="index" />
        <Tabs.Screen name="plan" />
        <Tabs.Screen name="intelligence" options={{ href: null }} />
        <Tabs.Screen name="progress" />
        <Tabs.Screen name="profile" />
      </Tabs>
    </WebLayout>
  );
}
