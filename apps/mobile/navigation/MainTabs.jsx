import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import HomeScreen from '../screens/HomeScreen';
import FindLoadsScreen from '../screens/FindLoadsScreen';
import PostLoadScreen from '../screens/PostLoadScreen';
import TruckDetailsScreen from '../screens/TruckDetailsScreen';
import WalletScreen from '../screens/WalletScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

// Truck-owning accounts (matches backend TRUCK_ROLES in routes/trucks.js)
// post trucks, not loads — they get a My Trucks tab instead of Post Load.
const TRUCK_OWNER_TYPES = ['driver', 'vehicle_owner'];

// icon name pairs: [outline, filled] from MaterialCommunityIcons
const TAB_ICONS = {
  Home: ['view-dashboard-outline', 'view-dashboard'],
  Loads: ['truck-outline', 'truck'],
  Create: ['plus-circle-outline', 'plus-circle'],
  MyTrucks: ['truck-check-outline', 'truck-check'],
  Wallet: ['wallet-outline', 'wallet'],
  Profile: ['account-circle-outline', 'account-circle']
};

export default function MainTabs() {
  // Fixed height/paddingBottom would clip the tab bar under the gesture
  // nav bar / home indicator on devices with a bottom inset — add it back
  // on top of the base size instead of letting the fixed values swallow it.
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  // Same ['profile'] cache AuthGate already populated before this screen can
  // even mount (Main only renders once `profile` exists) — reading it here
  // is free, no extra request and no loading flash.
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: api.profile.me });
  const isTruckOwner = TRUCK_OWNER_TYPES.includes(profile?.user_type);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#f97316',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: {
          borderTopColor: '#e2e8f0',
          height: 58 + insets.bottom,
          paddingTop: 4,
          paddingBottom: Math.max(insets.bottom, 4)
        },
        tabBarIcon: ({ focused, color, size }) => {
          const [outline, filled] = TAB_ICONS[route.name];
          return <Icon name={focused ? filled : outline} color={color} size={size} />;
        }
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen
        name="Loads"
        component={FindLoadsScreen}
        options={{
          headerShown: true,
          title: 'Find Loads',
          headerTitleStyle: { fontWeight: '800', color: '#0f172a' }
        }}
      />
      {isTruckOwner ? (
        <Tab.Screen
          name="MyTrucks"
          component={TruckDetailsScreen}
          options={{
            headerShown: true,
            title: t('myTrucks'),
            headerTitleStyle: { fontWeight: '800', color: '#0f172a' }
          }}
        />
      ) : (
        <Tab.Screen
          name="Create"
          component={PostLoadScreen}
          options={{
            headerShown: true,
            title: 'Post Load',
            headerTitleStyle: { fontWeight: '800', color: '#0f172a' }
          }}
        />
      )}
      <Tab.Screen
        name="Wallet"
        component={WalletScreen}
        options={{
          headerShown: true,
          title: t('walletBalance'),
          headerTitleStyle: { fontWeight: '800', color: '#0f172a' }
        }}
      />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
