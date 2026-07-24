import { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Checkbox, Button, HelperText } from 'react-native-paper';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';

export default function TermsAcceptanceScreen() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [error, setError] = useState('');

  const acceptTerms = useMutation({
    mutationFn: () => api.auth.acceptTerms(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['consents-status'] }),
    onError: (err) => setError(err.message)
  });

  const canContinue = agreedTerms && agreedPrivacy;

  const handleContinue = () => {
    if (!canContinue) return setError(t('mustAcceptToContinue'));
    setError('');
    acceptTerms.mutate();
  };

  return (
    <ScrollView
      className="flex-1 bg-orange-50"
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
    >
      <Text className="mb-3 text-center text-2xl font-bold text-slate-900">{t('acceptTermsTitle')}</Text>
      <Text className="mb-6 text-center text-sm text-slate-500">{t('acceptTermsBody')}</Text>

      <View className="rounded-2xl bg-white p-4">
        <View className="flex-row items-center">
          <Checkbox
            status={agreedTerms ? 'checked' : 'unchecked'}
            onPress={() => setAgreedTerms((v) => !v)}
            color="#f97316"
          />
          <Text className="flex-1 text-sm text-slate-700">{t('iAgreeTerms')}</Text>
        </View>
        <View className="mt-2 flex-row items-center">
          <Checkbox
            status={agreedPrivacy ? 'checked' : 'unchecked'}
            onPress={() => setAgreedPrivacy((v) => !v)}
            color="#f97316"
          />
          <Text className="flex-1 text-sm text-slate-700">{t('iAgreePrivacy')}</Text>
        </View>
      </View>

      <HelperText type="error" visible={!!error}>
        {error}
      </HelperText>

      <Button
        mode="contained"
        buttonColor="#f97316"
        className="mt-2"
        loading={acceptTerms.isPending}
        disabled={acceptTerms.isPending}
        onPress={handleContinue}
      >
        {t('acceptAndContinue')}
      </Button>
    </ScrollView>
  );
}
