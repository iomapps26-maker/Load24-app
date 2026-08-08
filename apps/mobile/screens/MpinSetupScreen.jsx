import { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput, Button, HelperText } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import ConfirmDetailsCheckbox from '../components/ConfirmDetailsCheckbox';

const MPIN_PATTERN = /^\d{4,6}$/;

// Used both as a gating screen (props onDone/onSkip supplied by AuthGate)
// and as a normal pushed screen from Profile > MPIN Lock (falls back to
// navigation.goBack() when those props aren't supplied).
export default function MpinSetupScreen({ onDone, onSkip }) {
  const navigation = useNavigation();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0); // 0: enter, 1: confirm
  const [mpin, setMpin] = useState('');
  const [confirmMpin, setConfirmMpin] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const finish = () => {
    queryClient.invalidateQueries({ queryKey: ['profile'] });
    if (onDone) onDone();
    else navigation.goBack();
  };

  const skip = () => {
    if (onSkip) onSkip();
    else navigation.goBack();
  };

  const setMpinMutation = useMutation({
    mutationFn: () => api.auth.mpinSet(mpin),
    onSuccess: finish,
    onError: (err) => setError(err.message)
  });

  const handleNext = () => {
    setError('');
    if (!MPIN_PATTERN.test(mpin)) return setError(t('mpinInvalidLength'));
    setStep(1);
  };

  const handleConfirm = () => {
    setError('');
    if (confirmMpin !== mpin) return setError(t('mpinMismatch'));
    setMpinMutation.mutate();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-orange-50"
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
        <Text className="mb-2 text-center text-2xl font-bold text-slate-900">
          {step === 0 ? t('setMpinTitle') : t('confirmMpinTitle')}
        </Text>
        {step === 0 && <Text className="mb-6 text-center text-sm text-slate-500">{t('setMpinDesc')}</Text>}

        <View className="rounded-2xl bg-white p-5">
          {step === 0 ? (
            <TextInput
              mode="outlined"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              value={mpin}
              onChangeText={setMpin}
              placeholder={t('enterMpin')}
              autoFocus
            />
          ) : (
            <TextInput
              mode="outlined"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              value={confirmMpin}
              onChangeText={setConfirmMpin}
              placeholder={t('confirmMpinLabel')}
              autoFocus
            />
          )}
        </View>

        <HelperText type="error" visible={!!error}>
          {error}
        </HelperText>

        {step === 1 && <ConfirmDetailsCheckbox checked={confirmed} onChange={setConfirmed} t={t} />}

        <Button
          mode="contained"
          buttonColor="#f97316"
          className="mt-2"
          loading={setMpinMutation.isPending}
          disabled={setMpinMutation.isPending || (step === 1 && !confirmed)}
          onPress={step === 0 ? handleNext : handleConfirm}
        >
          {step === 0 ? t('next') : t('confirmMpinButton')}
        </Button>

        {step === 0 && (
          <Button mode="text" className="mt-2" onPress={skip}>
            {t('skipForNow')}
          </Button>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
