import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import HomeScreen from '../screens/HomeScreen';
import FindLoadsScreen from '../screens/FindLoadsScreen';
import PostLoadScreen from '../screens/PostLoadScreen';
import ChatScreen from '../screens/ChatScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

// icon name pairs: [outline, filled] from MaterialCommunityIcons
const TAB_ICONS = {
  Home: ['view-dashboard-outline', 'view-dashboard'],
  Loads: ['truck-outline', 'truck'],
  Create: ['plus-circle-outline', 'plus-circle'],
  Chat: ['chat-outline', 'chat'],
  Profile: ['account-circle-outline', 'account-circle']
};

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#f97316',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: { borderTopColor: '#e2e8f0', paddingBottom: 4, height: 58 },
        tabBarIcon: ({ focused, color, size }) => {
          const [outline, filled] = TAB_ICONS[route.name];
          return <Icon name={focused ? filled : outline} color={color} size={size} />;
        }
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Loads" component={FindLoadsScreen} options={{ headerShown: true, title: 'Find Loads' }} />
      <Tab.Screen name="Create" component={PostLoadScreen} options={{ headerShown: true, title: 'Post Load' }} />
      <Tab.Screen name="Chat" component={ChatScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
