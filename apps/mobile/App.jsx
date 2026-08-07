import './global.css';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { SystemBars } from 'react-native-edge-to-edge';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { LanguageProvider, useLanguage } from './lib/i18n';
import { queryClient } from './lib/queryClient';
import { api } from './lib/api';
import { navigationRef, navigate } from './lib/navigationRef';
import { consumePostLoginIntent } from './lib/postLoginIntent';
import LandingScreen from './screens/LandingScreen';
import AuthChoiceScreen from './screens/AuthChoiceScreen';
import ProfileSetupScreen from './screens/ProfileSetupScreen';
import ProfitCalculatorScreen from './screens/ProfitCalculatorScreen';
import FinancialForecastScreen from './screens/FinancialForecastScreen';
import KycVerificationScreen from './screens/KycVerificationScreen';
import TruckDetailsScreen from './screens/TruckDetailsScreen';
import PostTruckScreen from './screens/PostTruckScreen';
import SupportTicketsScreen from './screens/SupportTicketsScreen';
import WalletScreen from './screens/WalletScreen';
import TermsAcceptanceScreen from './screens/TermsAcceptanceScreen';
import MpinSetupScreen from './screens/MpinSetupScreen';
import LinkedAccountsScreen from './screens/LinkedAccountsScreen';
import LockScreen from './screens/LockScreen';
import SeeBiddingScreen from './screens/SeeBiddingScreen';
import TripDetailsScreen from './screens/TripDetailsScreen';
import PlaceBidScreen from './screens/PlaceBidScreen';
import MainTabs from './navigation/MainTabs';
import { isExternalPickerActive } from './lib/pickerGuard';

const Stack = createNativeStackNavigator();

// How long the app can sit backgrounded before returning triggers an MPIN
// re-lock — short interruptions (a notification banner, switching to check
// something and back) shouldn't force the user to unlock again.
const LOCK_GRACE_MS = 40000;

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
  const queryClient = useQueryClient();
  const { data: profile, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['profile'],
    queryFn: api.profile.me,
    enabled: isAuthenticated
  });

  // Blocks non-onboarding routes on the backend too (requireConsents) —
  // checked here so the app can show the terms screen proactively instead
  // of bouncing off a 403 from whichever route loads first. Doesn't depend
  // on `profile` server-side (consents are keyed off the auth user, not the
  // profile row), so it fires alongside the profile fetch instead of
  // waiting on it — the result just isn't used until profile is known.
  const { data: consentsStatus, isLoading: isLoadingConsents } = useQuery({
    queryKey: ['consents-status'],
    queryFn: api.auth.consentsStatus,
    enabled: isAuthenticated
  });
  const needsTerms = (consentsStatus?.missing_consents?.length ?? 0) > 0;

  // Re-locks the app with the MPIN screen after it's spent LOCK_GRACE_MS+ in
  // the background — external pickers (camera/gallery/documents) also
  // background the app momentarily, so those are excluded via pickerGuard
  // rather than treated as the user leaving.
  const [locked, setLocked] = useState(false);
  const backgroundedAtRef = useRef(null);
  const hasCheckedStartupLockRef = useRef(false);

  // hasCheckedStartupLockRef only ever flips true->stays true for the life
  // of this component, but AuthGate itself stays mounted across sign-out ->
  // sign-in (no remount) — without this, signing out and back into an
  // account that *does* have an MPIN set skips the startup lock entirely,
  // landing straight in the app as if MPIN had never been set. Stale
  // cross-account query cache (profile, loads, ...) is the same class of
  // bug, so clear it here too rather than only resetting the lock ref.
  useEffect(() => {
    if (!isAuthenticated) {
      hasCheckedStartupLockRef.current = false;
      setLocked(false);
      queryClient.clear();
    }
  }, [isAuthenticated, queryClient]);

  // Cold app starts never fire an AppState background->active transition,
  // so the resume-based lock below never runs on launch. Lock as soon as we
  // know the profile has an MPIN set, once per app session.
  useEffect(() => {
    if (!hasCheckedStartupLockRef.current && profile) {
      hasCheckedStartupLockRef.current = true;
      if (profile.has_mpin) {
        setLocked(true);
      }
    }
  }, [profile]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        const backgroundedAt = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (backgroundedAt && profile?.has_mpin && Date.now() - backgroundedAt >= LOCK_GRACE_MS) {
          setLocked(true);
        }
      } else if (!isExternalPickerActive() && !backgroundedAtRef.current) {
        backgroundedAtRef.current = Date.now();
      }
    });
    return () => subscription.remove();
  }, [profile]);

  // Consumes an intent set by a signed-out entry point (LandingScreen's "I am
  // a vehicle owner" button) once the authenticated app tree is actually
  // reachable — before that (still loading, mid profile-setup, terms not yet
  // accepted) TruckDetails isn't mounted in this Stack.Navigator yet.
  // consumePostLoginIntent() is a pop, so re-running this on every render is
  // harmless — it's a no-op once the intent has already been consumed.
  // Only driver/vehicle_owner accounts can actually register a truck (see
  // TRUCK_ROLES in apps/backend/src/routes/trucks.js) — someone who signed
  // in or set up their profile with a different role lands on the normal
  // home screen instead, same as if they'd never tapped the CTA.
  useEffect(() => {
    if (isAuthenticated && profile && !needsTerms) {
      const intent = consumePostLoginIntent();
      if (intent === 'truck' && ['driver', 'vehicle_owner'].includes(profile.user_type)) {
        navigate('TruckDetails');
      }
    }
  }, [isAuthenticated, profile, needsTerms]);

  const isLoadingGate =
    isLoadingAuth || (isAuthenticated && isLoadingProfile) || (isAuthenticated && !!profile && isLoadingConsents);

  if (isLoadingGate) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  if (isAuthenticated && locked) {
    return <LockScreen onUnlock={() => setLocked(false)} />;
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
                name="LinkedAccounts"
                component={LinkedAccountsScreen}
                options={{ headerShown: true, title: t('linkedAccounts') }}
              />
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
                name="TruckDetails"
                component={TruckDetailsScreen}
                options={{ headerShown: true, title: t('myTrucks') }}
              />
              <Stack.Screen
                name="PostTruck"
                component={PostTruckScreen}
                options={{ headerShown: true, title: 'Post Truck Availability' }}
              />
              <Stack.Screen
                name="SupportTickets"
                component={SupportTicketsScreen}
                options={{ headerShown: true, title: t('supportTickets') }}
              />
              <Stack.Screen name="Wallet" component={WalletScreen} options={{ headerShown: true, title: t('walletBalance') }} />
              <Stack.Screen name="SeeBidding" component={SeeBiddingScreen} options={{ headerShown: true, title: t('seeBidding') }} />
              <Stack.Screen name="TripDetails" component={TripDetailsScreen} options={{ headerShown: true, title: t('tripDetails') }} />
              <Stack.Screen name="PlaceBid" component={PlaceBidScreen} options={{ headerShown: true, title: t('placeBid') }} />
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
      <SystemBars style="dark" />
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <LanguageProvider>
            <AuthProvider>
              <PaperProvider theme={paperTheme} settings={{ icon: (props) => <Icon {...props} /> }}>
                <NavigationContainer ref={navigationRef}>
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
