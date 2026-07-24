import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput, Button, HelperText } from 'react-native-paper';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/i18n';

// Local unlock gate shown in front of the already-cached Supabase session
// (see apps/mobile lib/supabase.js persistSession) when the app resumes
// after being backgrounded. mpin/login just re-confirms identity; on
// lockout (429) the user can fall back to a full password sign-in instead
// of being stuck.
export default function LockScreen({ onUnlock }) {
  const { t } = useLanguage();
  const { user, signInWithPassword, signOut } = useAuth();
  const [mode, setMode] = useState('mpin'); // 'mpin' | 'password'
  const [mpin, setMpin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);

  const mpinLogin = useMutation({
    mutationFn: () => api.auth.mpinLogin(mpin),
    onSuccess: () => onUnlock(),
    onError: (err) => {
      setMpin('');
      if (err.status === 429) {
        setLocked(true);
        setError(t('mpinLockedTryLater'));
        return;
      }
      const remaining = err.attempts_remaining;
      setError(remaining != null ? `${t('wrongMpin')} — ${remaining} ${t('attemptsRemaining')}` : t('wrongMpin'));
    }
  });

  const passwordLogin = useMutation({
    mutationFn: async () => {
      const { error: signInError } = await signInWithPassword(user?.email, password);
      if (signInError) throw signInError;
    },
    onSuccess: () => onUnlock(),
    onError: (err) => setError(err.message)
  });

  const switchMode = () => {
    setError('');
    setMode((m) => (m === 'mpin' ? 'password' : 'mpin'));
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 items-center justify-center bg-orange-50 px-6"
    >
      <Text className="mb-2 text-center text-2xl font-bold text-slate-900">
        {mode === 'mpin' ? t('unlockTitle') : t('signInWithPasswordTitle')}
      </Text>
      {mode === 'mpin' && <Text className="mb-6 text-center text-sm text-slate-500">{t('unlockDesc')}</Text>}

      <View className="w-full rounded-2xl bg-white p-5">
        {mode === 'mpin' ? (
          <TextInput
            mode="outlined"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={mpin}
            onChangeText={setMpin}
            placeholder={t('enterMpin')}
            editable={!locked}
            autoFocus
          />
        ) : (
          <TextInput
            mode="outlined"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder={t('password')}
            autoFocus
          />
        )}
      </View>

      <HelperText type="error" visible={!!error}>
        {error}
      </HelperText>

      <Button
        mode="contained"
        buttonColor="#f97316"
        className="mt-2 w-full"
        loading={mode === 'mpin' ? mpinLogin.isPending : passwordLogin.isPending}
        disabled={mode === 'mpin' ? locked || mpin.length < 4 || mpinLogin.isPending : !password || passwordLogin.isPending}
        onPress={() => {
          setError('');
          if (mode === 'mpin') mpinLogin.mutate();
          else passwordLogin.mutate();
        }}
      >
        {mode === 'mpin' ? t('unlock') : t('signIn')}
      </Button>

      <Button mode="text" className="mt-2" onPress={switchMode}>
        {mode === 'mpin' ? t('usePasswordInstead') : t('unlock')}
      </Button>

      <Button mode="text" onPress={signOut}>
        {t('signOut')}
      </Button>
    </KeyboardAvoidingView>
  );
}
