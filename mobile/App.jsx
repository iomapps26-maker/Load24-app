import './global.css';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PaperProvider } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { LanguageProvider } from './lib/i18n';
import { queryClient } from './lib/queryClient';
import { api } from './lib/api';
import LandingScreen from './screens/LandingScreen';
import AuthChoiceScreen from './screens/AuthChoiceScreen';
import LoginScreen from './screens/LoginScreen';
import ProfileSetupScreen from './screens/ProfileSetupScreen';
import MainTabs from './navigation/MainTabs';

const Stack = createNativeStackNavigator();

// Swaps between the auth stack, profile-setup, and the app stack based on
// Supabase session state and whether a user_profiles row exists yet — same
// role the web app's <AuthProvider>/<AuthenticatedApp> pair played.
function AuthGate() {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const { data: profile, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['profile'],
    queryFn: api.profile.me,
    enabled: isAuthenticated
  });

  if (isLoadingAuth || (isAuthenticated && isLoadingProfile)) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthenticated ? (
        profile ? (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} options={{ headerShown: true, title: 'Edit Profile' }} />
          </>
        ) : (
          <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
        )
      ) : (
        <>
          <Stack.Screen name="Landing" component={LandingScreen} />
          <Stack.Screen name="AuthChoice" component={AuthChoiceScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
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
              <PaperProvider settings={{ icon: (props) => <Icon {...props} /> }}>
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
