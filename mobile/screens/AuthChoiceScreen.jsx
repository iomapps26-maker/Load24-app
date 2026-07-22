import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity } from 'react-native';
import { TextInput, Button, HelperText } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/i18n';

export default function AuthChoiceScreen() {
  const navigation = useNavigation();
  const {
    signInWithGoogle,
    signInWithPassword,
    signUpWithPassword,
    verifySignupOtp,
    resendSignupOtp,
    resetPassword
  } = useAuth();
  const { t } = useLanguage();

  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'signupOtp'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  const resetMessages = () => { setError(''); setInfo(''); };

  const handleGoogle = async () => {
    resetMessages();
    setOauthLoading(true);
    const { error: err } = await signInWithGoogle();
    setOauthLoading(false);
    if (err) setError(err.message);
    // On success the OS browser opens; AuthContext's deep-link listener
    // picks up the redirect and the AuthGate in App.jsx swaps screens.
  };

  const handleSignIn = async () => {
    resetMessages();
    setLoading(true);
    const { error: err } = await signInWithPassword(email.trim(), password);
    setLoading(false);
    if (err) setError(err.message);
  };

  const handleSignUp = async () => {
    resetMessages();
    if (password !== confirmPassword) return setError(t('passwordsDontMatch'));
    setLoading(true);
    const { error: err } = await signUpWithPassword(email.trim(), password);
    setLoading(false);
    if (err) return setError(err.message);
    setMode('signupOtp');
  };

  const handleVerifySignupOtp = async () => {
    resetMessages();
    setLoading(true);
    const { error: err } = await verifySignupOtp(email.trim(), otp.trim());
    setLoading(false);
    if (err) return setError(err.message);
    // Supabase signs the user in on successful verification — AuthGate
    // picks up the new session and swaps to ProfileSetup automatically.
  };

  const handleResendOtp = async () => {
    resetMessages();
    const { error: err } = await resendSignupOtp(email.trim());
    if (err) return setError(err.message);
    setInfo(t('accountCreated'));
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) return setError(t('email'));
    resetMessages();
    const { error: err } = await resetPassword(email.trim());
    if (err) return setError(err.message);
    setInfo(t('resetLinkSent'));
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-slate-100"
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }}>
        <View className="items-center">
          <View className="-mb-8 z-10 h-20 w-20 items-center justify-center rounded-full bg-white shadow">
            <Text className="text-2xl">🚚</Text>
          </View>
        </View>

        <View className="rounded-3xl bg-white px-6 pb-6 pt-12 shadow">
          {mode === 'signupOtp' ? (
            <>
              <Text className="mb-1 text-center text-2xl font-bold text-navy">{t('verifyEmail')}</Text>
              <Text className="mb-6 text-center text-slate-500">
                {t('enterOtpSentTo')} {email}
              </Text>

              <Text className="mb-1 text-sm text-slate-600">{t('sixDigitCode')}</Text>
              <TextInput
                mode="outlined"
                keyboardType="number-pad"
                value={otp}
                onChangeText={setOtp}
                left={<TextInput.Icon icon="shield-key-outline" />}
              />

              <HelperText type="error" visible={!!error}>{error}</HelperText>
              <HelperText type="info" visible={!!info}>{info}</HelperText>

              <Button
                mode="contained"
                buttonColor="#0f172a"
                loading={loading}
                disabled={!otp || loading}
                onPress={handleVerifySignupOtp}
                className="mt-1"
              >
                {t('verifyAndCreateAccount')}
              </Button>

              <TouchableOpacity className="mt-4 items-center" onPress={handleResendOtp}>
                <Text className="text-sm text-brand">{t('resendCode')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text className="mb-1 text-center text-2xl font-bold text-navy">{t('welcomeTitle')}</Text>
              <Text className="mb-6 text-center text-slate-500">{t('signInToContinue')}</Text>

              <Button
                mode="outlined"
                icon="google"
                textColor="#1f2937"
                style={{ borderColor: '#e2e8f0' }}
                className="mb-4"
                loading={oauthLoading}
                disabled={oauthLoading}
                onPress={handleGoogle}
              >
                {t('continueWithGoogle')}
              </Button>

              <View className="mb-4 flex-row items-center">
                <View className="h-px flex-1 bg-slate-200" />
                <Text className="mx-3 text-xs text-slate-400">{t('or')}</Text>
                <View className="h-px flex-1 bg-slate-200" />
              </View>

              <Text className="mb-1 text-sm text-slate-600">{t('email')}</Text>
              <TextInput
                mode="outlined"
                placeholder="you@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                left={<TextInput.Icon icon="email-outline" />}
                className="mb-3"
              />

              <Text className="mb-1 text-sm text-slate-600">{t('password')}</Text>
              <TextInput
                mode="outlined"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                left={<TextInput.Icon icon="lock-outline" />}
                className={mode === 'signup' ? 'mb-3' : undefined}
              />

              {mode === 'signup' && (
                <>
                  <Text className="mb-1 text-sm text-slate-600">{t('confirmPassword')}</Text>
                  <TextInput
                    mode="outlined"
                    secureTextEntry
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    left={<TextInput.Icon icon="lock-check-outline" />}
                  />
                </>
              )}

              <HelperText type="error" visible={!!error}>{error}</HelperText>
              <HelperText type="info" visible={!!info}>{info}</HelperText>

              <Button
                mode="contained"
                buttonColor="#0f172a"
                loading={loading}
                disabled={
                  loading ||
                  !email ||
                  !password ||
                  (mode === 'signup' && !confirmPassword)
                }
                onPress={mode === 'signin' ? handleSignIn : handleSignUp}
                className="mt-1"
              >
                {mode === 'signin' ? t('signIn') : t('createAccount')}
              </Button>

              {mode === 'signin' && (
                <TouchableOpacity className="mt-4 items-center" onPress={handleForgotPassword}>
                  <Text className="text-sm text-brand">{t('forgotPassword')}</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                className="mt-3 flex-row items-center justify-center"
                onPress={() => {
                  resetMessages();
                  setPassword('');
                  setConfirmPassword('');
                  setMode(mode === 'signin' ? 'signup' : 'signin');
                }}
              >
                <Text className="text-sm text-slate-500">
                  {mode === 'signin' ? t('needAccount') : t('haveAccount')}{' '}
                </Text>
                <Text className="text-sm font-bold text-navy">{mode === 'signin' ? t('signUp') : t('signIn')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <Button mode="text" textColor="#64748b" className="mt-4" onPress={() => navigation.goBack()}>
          {t('back')}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
