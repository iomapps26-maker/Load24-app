import { createNavigationContainerRef } from '@react-navigation/native';

// Lets code outside a screen component (AuthGate, which sits above the
// Stack.Navigator rather than inside one of its screens, so useNavigation()
// isn't available to it) drive navigation once the container is mounted.
export const navigationRef = createNavigationContainerRef();

export function navigate(name, params) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}
