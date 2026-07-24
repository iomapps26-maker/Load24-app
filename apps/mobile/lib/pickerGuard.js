// Launching the camera, gallery, or document picker briefly backgrounds the
// RN app (a separate system Activity takes over) — App.jsx's AppState-based
// MPIN re-lock timer would otherwise treat that as "user left the app" and
// re-lock behind their back the moment they return, silently abandoning
// whatever upload was in progress. Screens wrap picker calls with
// beginExternalPicker()/endExternalPicker() so App.jsx can tell the
// difference between that and actually backgrounding the app.
let activeCount = 0;

export function beginExternalPicker() {
  activeCount += 1;
}

export function endExternalPicker() {
  activeCount = Math.max(0, activeCount - 1);
}

export function isExternalPickerActive() {
  return activeCount > 0;
}
