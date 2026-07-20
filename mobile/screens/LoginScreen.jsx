import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput, Button, HelperText } from 'react-native-paper';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/i18n';

export default function LoginScreen() {
  const { sendOtp, verifyOtp } = useAuth();
  const { t } = useLanguage();
  const [step, setStep] = useState('email'); // 'email' | 'otp'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async () => {
    setError('');
    setLoading(true);
    const { error: err } = await sendOtp(email.trim());
    setLoading(false);
    if (err) return setError(err.message);
    setStep('otp');
  };

  const handleVerifyOtp = async () => {
    setError('');
    setLoading(true);
    const { error: err } = await verifyOtp(email.trim(), code.trim());
    setLoading(false);
    if (err) return setError(err.message);
    // AuthGate in App.jsx swaps to the app stack once the session updates.
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 justify-center bg-white px-6"
    >
      <Text className="mb-2 text-3xl font-bold text-brand">{t('appName')}</Text>
      <Text className="mb-8 text-slate-500">{t('tagline')}</Text>

      {step === 'email' ? (
        <>
          <TextInput
            mode="outlined"
            label={t('email')}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <HelperText type="error" visible={!!error}>{error}</HelperText>
          <Button mode="contained" loading={loading} disabled={!email || loading} onPress={handleSendOtp}>
            {t('sendCode')}
          </Button>
        </>
      ) : (
        <>
          <Text className="mb-3 text-slate-600">{t('enterCode')} {email}</Text>
          <TextInput
            mode="outlined"
            label={t('sixDigitCode')}
            keyboardType="number-pad"
            value={code}
            onChangeText={setCode}
          />
          <HelperText type="error" visible={!!error}>{error}</HelperText>
          <Button mode="contained" loading={loading} disabled={!code || loading} onPress={handleVerifyOtp}>
            {t('verifyAndSignIn')}
          </Button>
          <Button mode="text" onPress={() => setStep('email')} className="mt-2">
            {t('useDifferentEmail')}
          </Button>
        </>
      )}
    </KeyboardAvoidingView>
  );
}
