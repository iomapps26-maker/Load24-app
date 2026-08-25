package com.base699327bbace8d2c0b141d1bc.app

import android.content.Intent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "LOAD24"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  // MainActivity is launchMode="singleTask" (AndroidManifest.xml) so a deep
  // link tapped while the app is already running (or backgrounded) reuses
  // this same Activity instance via onNewIntent rather than a fresh start —
  // without forwarding that new intent here, React Native's Linking module
  // (AuthContext.js's OAuth-callback listener, and App.jsx's load-link
  // listener) never sees it: Linking.getInitialURL() keeps returning the
  // *original* launch intent, and no 'url' event fires for the new one.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
  }
}
