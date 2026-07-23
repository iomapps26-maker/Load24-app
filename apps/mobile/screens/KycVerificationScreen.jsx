import { View, Text } from 'react-native';
import { Icon, Button } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';

const KYC_BADGE = {
  pending: { key: 'kycStatusPending', bg: 'bg-slate-100', text: 'text-slate-600' },
  partial: { key: 'kycStatusPartial', bg: 'bg-orange-100', text: 'text-orange-700' },
  submitted: { key: 'kycStatusSubmitted', bg: 'bg-blue-100', text: 'text-blue-700' },
  verified: { key: 'kycStatusVerified', bg: 'bg-green-100', text: 'text-green-700' },
  rejected: { key: 'kycStatusRejected', bg: 'bg-red-100', text: 'text-red-700' }
};

export default function KycVerificationScreen() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: api.profile.me });

  const submitKyc = useMutation({
    mutationFn: api.profile.submitKyc,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile'] })
  });

  const status = profile?.kyc_status ?? 'pending';
  const badge = KYC_BADGE[status] ?? KYC_BADGE.pending;
  const canSubmit = status === 'pending' || status === 'partial';

  return (
    <View className="flex-1 items-center bg-white px-8 pt-16">
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-blue-50">
        <Icon source="shield-check-outline" size={32} color="#2563eb" />
      </View>
      <Text className="mb-3 text-center text-lg font-bold text-slate-900">{t('kycVerification')}</Text>
      <View className={`mb-4 rounded-full px-4 py-2 ${badge.bg}`}>
        <Text className={`text-sm font-semibold ${badge.text}`}>{t(badge.key)}</Text>
      </View>
      <Text className="mb-6 text-center text-sm text-slate-500">{t('kycSubmitDesc')}</Text>

      {canSubmit && (
        <Button
          mode="contained"
          buttonColor="#f97316"
          loading={submitKyc.isPending}
          disabled={submitKyc.isPending}
          onPress={() => submitKyc.mutate()}
        >
          {t('submitKyc')}
        </Button>
      )}
    </View>
  );
}
