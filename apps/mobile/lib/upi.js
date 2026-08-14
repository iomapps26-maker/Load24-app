import { Alert, Linking } from 'react-native';

// LOAD24's own UPI collection account — the one shown as "UPI Payment" on
// Home/Wallet. The PhonePe/GPay/Paytm/BHIM buttons deep-link into that
// specific app pre-filled with this payee, rather than a generic UPI intent,
// so each button actually opens the app it's labelled for.
export const DEFAULT_UPI_PAYEE = {
  pa: 'internationalonlinemedia@icici',
  pn: 'INTERNATIONAL ONLINE MEDIA'
};

// The alternate authorized UPI collection contact shown alongside LOAD24's
// own account (see WalletScreen/HomeScreen's "Vivek Gupta" card).
export const VIVEK_UPI_PAYEE = {
  pa: 'vivek9555921555@oksbi',
  pn: 'Vivek Gupta'
};

// Each app registers its own custom URI scheme for a pay request; `upi://`
// is the generic scheme every UPI app (including BHIM) also responds to, so
// it's used as the BHIM/UPI button's target and as the fallback if a
// specific app's scheme isn't handled.
const UPI_SCHEMES = {
  phonepe: 'phonepe',
  gpay: 'tez',
  paytm: 'paytmmp',
  bhim: 'upi'
};

function buildUpiUrl(scheme, payee) {
  const params = ['pa', 'pn', 'cu']
    .map((key) => {
      const value = key === 'cu' ? 'INR' : payee[key];
      return value ? `${key}=${encodeURIComponent(value)}` : null;
    })
    .filter(Boolean)
    .join('&');
  return `${scheme}://pay?${params}`;
}

// Opens the named UPI app straight to a pay screen for `payee`. If that app
// isn't installed, Android's startActivity rejects with an
// ActivityNotFoundException (surfaced here as a promise rejection) rather
// than silently doing nothing — caught below and shown as a clear "not
// installed" message instead of leaving the tap looking like a dead button.
export async function openUpiApp(app, t, payee = DEFAULT_UPI_PAYEE) {
  const scheme = UPI_SCHEMES[app];
  if (!scheme) return;

  try {
    await Linking.openURL(buildUpiUrl(scheme, payee));
  } catch {
    Alert.alert(t('upiAppNotInstalled'), t('upiAppNotInstalledDesc'));
  }
}
