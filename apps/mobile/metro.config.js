const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withNativeWind } = require('nativewind/metro');

// npm workspaces monorepo: most deps (@babel/runtime, react-native itself,
// etc.) are hoisted to the workspace root's node_modules rather than
// apps/mobile/node_modules. Metro's default config only watches/resolves
// within __dirname, so without this it can't find hoisted packages at all —
// same underlying issue as the Android Gradle path fixes in android/build.gradle.
const workspaceRoot = path.resolve(__dirname, '../..');

const config = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')],
    // Prefer compiled "main"/"module" output over the "react-native" field's
    // raw source — some libraries (react-native-paper) ship raw .tsx there,
    // which shouldn't go through our app's nativewind JSX transform.
    resolverMainFields: ['browser', 'main']
  }
});

module.exports = withNativeWind(config, { input: './global.css' });
