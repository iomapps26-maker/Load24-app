import './global.css';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { LanguageProvider, useLanguage } from './lib/i18n';
import { queryClient } from './lib/queryClient';
import { api } from './lib/api';
import LandingScreen from './screens/LandingScreen';
import AuthChoiceScreen from './screens/AuthChoiceScreen';
import ProfileSetupScreen from './screens/ProfileSetupScreen';
import ProfitCalculatorScreen from './screens/ProfitCalculatorScreen';
import FinancialForecastScreen from './screens/FinancialForecastScreen';
import KycVerificationScreen from './screens/KycVerificationScreen';
import SupportTicketsScreen from './screens/SupportTicketsScreen';
import TermsAcceptanceScreen from './screens/TermsAcceptanceScreen';
import MpinSetupScreen from './screens/MpinSetupScreen';
import MainTabs from './navigation/MainTabs';

const Stack = createNativeStackNavigator();

// Keeps every react-native-paper component (Button, Chip, TextInput focus
// outline, ActivityIndicator, etc.) on the brand orange instead of MD3's
// default purple, so the theme stays consistent without hand-coloring each
// screen individually.
const paperTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#f97316',
    secondary: '#1e3a8a'
  }
};

// Swaps between the auth stack, profile-setup, and the app stack based on
// Supabase session state and whether a user_profiles row exists yet — same
// role the web app's <AuthProvider>/<AuthenticatedApp> pair played.
function AuthGate() {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const { t } = useLanguage();
  const { data: profile, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['profile'],
    queryFn: api.profile.me,
    enabled: isAuthenticated
  });

  // Blocks non-onboarding routes on the backend too (requireConsents) —
  // checked here so the app can show the terms screen proactively instead
  // of bouncing off a 403 from whichever route loads first.
  const { data: consentsStatus, isLoading: isLoadingConsents } = useQuery({
    queryKey: ['consents-status'],
    queryFn: api.auth.consentsStatus,
    enabled: isAuthenticated && !!profile
  });
  const needsTerms = (consentsStatus?.missing_consents?.length ?? 0) > 0;

  const isLoadingGate =
    isLoadingAuth || (isAuthenticated && isLoadingProfile) || (isAuthenticated && !!profile && isLoadingConsents);

  if (isLoadingGate) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthenticated ? (
        profile ? (
          needsTerms ? (
            <Stack.Screen name="AcceptTerms" component={TermsAcceptanceScreen} />
          ) : (
            <>
              <Stack.Screen name="Main" component={MainTabs} />
              <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} options={{ headerShown: true, title: 'Edit Profile' }} />
              <Stack.Screen name="MpinSetup" component={MpinSetupScreen} options={{ headerShown: true, title: t('mpinSettings') }} />
              <Stack.Screen
                name="ProfitCalculator"
                component={ProfitCalculatorScreen}
                options={{ headerShown: true, title: t('profitCalculator') }}
              />
              <Stack.Screen
                name="FinancialForecast"
                component={FinancialForecastScreen}
                options={{ headerShown: true, title: t('financialForecast') }}
              />
              <Stack.Screen
                name="KycVerification"
                component={KycVerificationScreen}
                options={{ headerShown: true, title: t('kycVerification') }}
              />
              <Stack.Screen
                name="SupportTickets"
                component={SupportTicketsScreen}
                options={{ headerShown: true, title: t('supportTickets') }}
              />
            </>
          )
        ) : (
          <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
        )
      ) : (
        <>
          <Stack.Screen name="Landing" component={LandingScreen} />
          <Stack.Screen name="AuthChoice" component={AuthChoiceScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <LanguageProvider>
            <AuthProvider>
              <PaperProvider theme={paperTheme} settings={{ icon: (props) => <Icon {...props} /> }}>
                <NavigationContainer>
                  <AuthGate />
                </NavigationContainer>
              </PaperProvider>
            </AuthProvider>
          </LanguageProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
