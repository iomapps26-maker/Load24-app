import { useState } from 'react';
import { View, Text, Image, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity } from 'react-native';
import { TextInput, Button, HelperText } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/i18n';

// Only two sign-in paths are supported: Google OAuth and WhatsApp OTP.
// Email/password isn't offered — this app has no compatible email login flow.
export default function AuthChoiceScreen() {
  const navigation = useNavigation();
  const { signInWithGoogle, sendPhoneOtp, verifyPhoneOtp } = useAuth();
  const { t } = useLanguage();

  const [mode, setMode] = useState('choice'); // 'choice' | 'phone' | 'phoneOtp'
  const [phone, setPhone] = useState('');
  const [phoneOtp, setPhoneOtp] = useState('');
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

  const handleSendPhoneOtp = async () => {
    resetMessages();
    setLoading(true);
    const { error: err } = await sendPhoneOtp(phone.trim());
    setLoading(false);
    if (err) return setError(err.message);
    setMode('phoneOtp');
  };

  const handleResendPhoneOtp = async () => {
    resetMessages();
    const { error: err } = await sendPhoneOtp(phone.trim());
    if (err) return setError(err.message);
    setInfo(t('accountCreated'));
  };

  const handleVerifyPhoneOtp = async () => {
    resetMessages();
    setLoading(true);
    const { error: err } = await verifyPhoneOtp(phone.trim(), phoneOtp.trim());
    setLoading(false);
    if (err) return setError(err.message);
    // Supabase signs the user in on successful verification — AuthGate
    // picks up the new session and swaps screens automatically.
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-slate-100"
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }}>
        <View className="items-center">
          <View className="-mb-8 z-10 h-20 w-20 items-center justify-center rounded-full bg-white shadow">
            <Image source={require('../assets/logo-mark.png')} style={{ width: 44, height: 44 }} resizeMode="contain" />
          </View>
        </View>

        <View className="rounded-3xl bg-white px-6 pb-6 pt-12 shadow">
          {mode === 'phoneOtp' ? (
            <>
              <Text className="mb-1 text-center text-2xl font-bold text-navy">{t('verifyPhone')}</Text>
              <Text className="mb-6 text-center text-slate-500">
                {t('enterOtpSentToWhatsapp')} {phone}
              </Text>

              <Text className="mb-1 text-sm text-slate-600">{t('sixDigitCode')}</Text>
              <TextInput
                mode="outlined"
                keyboardType="number-pad"
                value={phoneOtp}
                onChangeText={setPhoneOtp}
                left={<TextInput.Icon icon="shield-key-outline" />}
              />

              <HelperText type="error" visible={!!error}>{error}</HelperText>
              <HelperText type="info" visible={!!info}>{info}</HelperText>

              <Button
                mode="contained"
                buttonColor="#25D366"
                loading={loading}
                disabled={!phoneOtp || loading}
                onPress={handleVerifyPhoneOtp}
                className="mt-1"
              >
                {t('verifyAndContinue')}
              </Button>

              <TouchableOpacity className="mt-4 items-center" onPress={handleResendPhoneOtp}>
                <Text className="text-sm text-brand">{t('resendCode')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                className="mt-3 items-center"
                onPress={() => {
                  resetMessages();
                  setPhoneOtp('');
                  setMode('phone');
                }}
              >
                <Text className="text-sm text-slate-500">{t('back')}</Text>
              </TouchableOpacity>
            </>
          ) : mode === 'phone' ? (
            <>
              <Text className="mb-1 text-center text-2xl font-bold text-navy">{t('continueWithWhatsapp')}</Text>
              <Text className="mb-6 text-center text-slate-500">{t('enterMobileNumberDesc')}</Text>

              <Text className="mb-1 text-sm text-slate-600">{t('mobileNumber')}</Text>
              <TextInput
                mode="outlined"
                placeholder="98765 43210"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
                left={<TextInput.Icon icon="whatsapp" />}
                className="mb-3"
              />

              <HelperText type="error" visible={!!error}>{error}</HelperText>
              <HelperText type="info" visible={!!info}>{info}</HelperText>

              <Button
                mode="contained"
                buttonColor="#25D366"
                loading={loading}
                disabled={!phone || loading}
                onPress={handleSendPhoneOtp}
                className="mt-1"
              >
                {t('sendCode')}
              </Button>

              <TouchableOpacity
                className="mt-4 items-center"
                onPress={() => {
                  resetMessages();
                  setPhone('');
                  setMode('choice');
                }}
              >
                <Text className="text-sm text-slate-500">{t('back')}</Text>
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

              <Button
                mode="outlined"
                icon="whatsapp"
                textColor="#25D366"
                style={{ borderColor: '#e2e8f0' }}
                onPress={() => {
                  resetMessages();
                  setMode('phone');
                }}
              >
                {t('continueWithWhatsapp')}
              </Button>

              <HelperText type="error" visible={!!error}>{error}</HelperText>
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
