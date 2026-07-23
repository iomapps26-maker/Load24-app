const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = mergeConfig(getDefaultConfig(__dirname), {
  resolver: {
    // Prefer compiled "main"/"module" output over the "react-native" field's
    // raw source — some libraries (react-native-paper) ship raw .tsx there,
    // which shouldn't go through our app's nativewind JSX transform.
    resolverMainFields: ['browser', 'main']
  }
});

module.exports = withNativeWind(config, { input: './global.css' });
