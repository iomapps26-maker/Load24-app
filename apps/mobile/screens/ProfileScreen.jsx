import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Icon, TextInput, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/i18n';

const ROLE_LABEL_KEYS = {
  shipper: 'roleShipper',
  transporter: 'roleTransporter',
  broker: 'roleBroker',
  truck_owner: 'roleTruckOwner',
  driver: 'roleDriver'
};

const KYC_BADGE = {
  pending: { key: 'kycStatusPending', bg: 'bg-slate-100', text: 'text-slate-600' },
  partial: { key: 'kycStatusPartial', bg: 'bg-orange-100', text: 'text-orange-700' },
  submitted: { key: 'kycStatusSubmitted', bg: 'bg-blue-100', text: 'text-blue-700' },
  verified: { key: 'kycStatusVerified', bg: 'bg-green-100', text: 'text-green-700' },
  rejected: { key: 'kycStatusRejected', bg: 'bg-red-100', text: 'text-red-700' }
};

function StarRow({ rating = 0, size = 20 }) {
  return (
    <View className="flex-row">
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon
          key={i}
          source={i <= Math.round(rating) ? 'star' : 'star-outline'}
          size={size}
          color={i <= Math.round(rating) ? '#f97316' : '#cbd5e1'}
        />
      ))}
    </View>
  );
}

function SectionCard({ children }) {
  return <View className="mx-4 mb-4 rounded-2xl border border-slate-200 bg-white p-5">{children}</View>;
}

function NavRow({ icon, iconColor, label, onPress }) {
  return (
    <TouchableOpacity
      className="mx-4 mb-3 flex-row items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4"
      onPress={onPress}
    >
      <View className="flex-row items-center">
        <Icon source={icon} size={20} color={iconColor} />
        <Text className="ml-3 text-base font-semibold text-slate-800">{label}</Text>
      </View>
      <Icon source="chevron-right" size={20} color="#94a3b8" />
    </TouchableOpacity>
  );
}

function BankDetailsCard({ t }) {
  const queryClient = useQueryClient();
  const { data: bank } = useQuery({ queryKey: ['bankDetails'], queryFn: api.bankDetails.me });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ account_holder_name: '', account_number: '', ifsc_code: '', bank_name: '' });

  const startEdit = () => {
    setForm({
      account_holder_name: bank?.account_holder_name ?? '',
      account_number: bank?.account_number ?? '',
      ifsc_code: bank?.ifsc_code ?? '',
      bank_name: bank?.bank_name ?? ''
    });
    setEditing(true);
  };

  const saveBank = useMutation({
    mutationFn: () => api.bankDetails.save(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bankDetails'] });
      setEditing(false);
    }
  });

  const canSave =
    form.account_holder_name.trim() && form.account_number.trim() && form.ifsc_code.trim() && form.bank_name.trim();

  return (
    <SectionCard>
      <View className="mb-3 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <Icon source="bank-outline" size={20} color="#2563eb" />
          <Text className="ml-2 text-base font-bold text-slate-900">{t('bankDetails')}</Text>
        </View>
        {!editing && (
          <TouchableOpacity className="flex-row items-center" onPress={startEdit}>
            <Icon source="pencil-outline" size={16} color="#334155" />
            <Text className="ml-1 text-sm font-semibold text-slate-700">{t('change')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {editing ? (
        <View>
          <TextInput
            mode="outlined"
            label={t('accountHolderName')}
            value={form.account_holder_name}
            onChangeText={(v) => setForm((f) => ({ ...f, account_holder_name: v }))}
            className="mb-3"
          />
          <TextInput
            mode="outlined"
            label={t('accountNumber')}
            keyboardType="number-pad"
            value={form.account_number}
            onChangeText={(v) => setForm((f) => ({ ...f, account_number: v }))}
            className="mb-3"
          />
          <TextInput
            mode="outlined"
            label={t('ifscCode')}
            autoCapitalize="characters"
            value={form.ifsc_code}
            onChangeText={(v) => setForm((f) => ({ ...f, ifsc_code: v }))}
            className="mb-3"
          />
          <TextInput
            mode="outlined"
            label={t('bank')}
            value={form.bank_name}
            onChangeText={(v) => setForm((f) => ({ ...f, bank_name: v }))}
            className="mb-4"
          />
          <View className="flex-row gap-3">
            <Button mode="outlined" className="flex-1" onPress={() => setEditing(false)}>
              {t('cancel')}
            </Button>
            <Button
              mode="contained"
              buttonColor="#f97316"
              className="flex-1"
              loading={saveBank.isPending}
              disabled={!canSave || saveBank.isPending}
              onPress={() => saveBank.mutate()}
            >
              {t('save')}
            </Button>
          </View>
        </View>
      ) : bank ? (
        <View>
          <Text className="text-xs text-slate-400">{t('accountHolderName')}</Text>
          <Text className="mb-2 text-sm font-semibold text-slate-800">{bank.account_holder_name}</Text>
          <Text className="text-xs text-slate-400">{t('accountNumber')}</Text>
          <Text className="mb-2 text-sm font-semibold text-slate-800">{bank.account_number}</Text>
          <View className="flex-row justify-between">
            <View>
              <Text className="text-xs text-slate-400">{t('ifscCode')}</Text>
              <Text className="text-sm font-semibold text-slate-800">{bank.ifsc_code}</Text>
            </View>
            <View>
              <Text className="text-xs text-slate-400">{t('bank')}</Text>
              <Text className="text-sm font-semibold text-slate-800">{bank.bank_name}</Text>
            </View>
          </View>
          <View
            className={`mt-3 self-start rounded-full px-3 py-1 ${bank.verified ? 'bg-green-100' : 'bg-orange-100'}`}
          >
            <Text className={`text-xs font-bold ${bank.verified ? 'text-green-700' : 'text-orange-700'}`}>
              {bank.verified ? `✅ ${t('bankVerified')}` : t('bankNotVerified')}
            </Text>
          </View>
        </View>
      ) : (
        <TouchableOpacity onPress={startEdit}>
          <Text className="text-sm font-semibold text-brand">+ {t('addBankDetails')}</Text>
        </TouchableOpacity>
      )}
    </SectionCard>
  );
}

function ReviewsCard({ profile, t }) {
  const { data: reviews = [] } = useQuery({ queryKey: ['reviews'], queryFn: api.reviews.mine });

  return (
    <SectionCard>
      <View className="mb-3 flex-row items-center">
        <Icon source="message-text-outline" size={20} color="#f97316" />
        <Text className="ml-2 text-base font-bold text-slate-900">{t('reviewsAndRatings')}</Text>
      </View>

      {reviews.length === 0 ? (
        <View className="items-center py-6">
          <StarRow rating={0} size={36} />
          <Text className="mt-3 text-base font-semibold text-slate-600">{t('noReviewsYet')}</Text>
          <Text className="mt-1 text-center text-sm text-slate-400">{t('reviewsAppearAfterDeal')}</Text>
        </View>
      ) : (
        <View>
          <View className="mb-3 flex-row items-center">
            <StarRow rating={profile?.rating_score ?? 0} />
            <Text className="ml-2 text-sm text-slate-500">
              {Number(profile?.rating_score ?? 0).toFixed(1)} · {profile?.total_ratings ?? 0} {t('reviewsCount')}
            </Text>
          </View>
          {reviews.map((review) => (
            <View key={review.id} className="mb-3 border-t border-slate-100 pt-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-semibold text-slate-800">{review.reviewer_name || t('appName')}</Text>
                <StarRow rating={review.rating} size={14} />
              </View>
              {!!review.comment && <Text className="mt-1 text-sm text-slate-500">{review.comment}</Text>}
            </View>
          ))}
        </View>
      )}
    </SectionCard>
  );
}

export default function ProfileScreen() {
  const navigation = useNavigation();
  const { user, signOut } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: api.profile.me });

  const deleteAccount = useMutation({
    mutationFn: api.profile.deleteAccount,
    onSuccess: async () => {
      queryClient.clear();
      await signOut();
    },
    onError: (err) => Alert.alert(t('deleteAccountConfirmTitle'), err.message)
  });

  const handleLogout = () => {
    Alert.alert(t('logout'), t('logoutConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('logout'), style: 'destructive', onPress: signOut }
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(t('deleteAccountConfirmTitle'), t('deleteAccountConfirmMessage'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('deleteAccountConfirmTitle'), style: 'destructive', onPress: () => deleteAccount.mutate() }
    ]);
  };

  if (!profile) return null;

  const roleKey = ROLE_LABEL_KEYS[profile.user_type];
  const kycBadge = KYC_BADGE[profile.kyc_status] ?? KYC_BADGE.pending;
  const initial = (profile.full_name || user?.email || '?').charAt(0).toUpperCase();
  const location = [profile.city, profile.state, profile.pincode].filter(Boolean).join(', ');

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ paddingVertical: 20 }}>
      <SectionCard>
        <View className="flex-row items-center">
          <View className="mr-4 h-16 w-16 items-center justify-center rounded-full bg-orange-100">
            <Text className="text-2xl font-bold text-brand">{initial}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-lg font-bold text-slate-900">{profile.full_name || '—'}</Text>
            <View className="mt-1 flex-row flex-wrap gap-2">
              {roleKey && (
                <View className="rounded-full border border-slate-300 px-3 py-1">
                  <Text className="text-xs font-semibold text-slate-700">{t(roleKey)}</Text>
                </View>
              )}
              <View className={`rounded-full px-3 py-1 ${kycBadge.bg}`}>
                <Text className={`text-xs font-semibold ${kycBadge.text}`}>{t(kycBadge.key)}</Text>
              </View>
            </View>
          </View>
        </View>

        <View className="mt-5 flex-row">
          <View className="flex-1 items-center">
            <Text className="text-2xl font-bold text-brand">{Math.round(profile.trust_score ?? 0)}</Text>
            <Text className="text-xs text-slate-500">{t('trustScore')}</Text>
          </View>
          <View className="flex-1 items-center">
            <Text className="text-2xl font-bold text-blue-600">{profile.total_deals ?? 0}</Text>
            <Text className="text-xs text-slate-500">{t('totalDeals')}</Text>
          </View>
          <View className="flex-1 items-center">
            <Text className="text-2xl font-bold text-green-600">{profile.completed_deals ?? 0}</Text>
            <Text className="text-xs text-slate-500">{t('completedDeals')}</Text>
          </View>
          <View className="flex-1 items-center">
            <StarRow rating={profile.rating_score ?? 0} size={16} />
            <Text className="mt-1 text-xs text-slate-500">
              {Number(profile.rating_score ?? 0).toFixed(1)} · {profile.total_ratings ?? 0} {t('reviewsCount')}
            </Text>
          </View>
        </View>
      </SectionCard>

      <SectionCard>
        <View className="mb-3 flex-row items-center justify-between">
          <View className="flex-row items-center">
            <Icon source="account-outline" size={20} color="#334155" />
            <Text className="ml-2 text-base font-bold text-slate-900">{t('personalInformation')}</Text>
          </View>
          <TouchableOpacity className="flex-row items-center" onPress={() => navigation.navigate('ProfileSetup')}>
            <Icon source="pencil-outline" size={16} color="#334155" />
            <Text className="ml-1 text-sm font-semibold text-slate-700">{t('edit')}</Text>
          </TouchableOpacity>
        </View>
        <View className="mb-2 flex-row items-center">
          <Icon source="phone-outline" size={16} color="#94a3b8" />
          <Text className="ml-3 text-sm text-slate-700">{profile.mobile}</Text>
        </View>
        <View className="mb-2 flex-row items-center">
          <Icon source="email-outline" size={16} color="#94a3b8" />
          <Text className="ml-3 text-sm text-slate-700">{profile.user_email || user?.email}</Text>
        </View>
        {!!profile.company_name && (
          <View className="mb-2 flex-row items-center">
            <Icon source="office-building-outline" size={16} color="#94a3b8" />
            <Text className="ml-3 text-sm text-slate-700">{profile.company_name}</Text>
          </View>
        )}
        {!!location && (
          <View className="flex-row items-center">
            <Icon source="map-marker-outline" size={16} color="#94a3b8" />
            <Text className="ml-3 text-sm text-slate-700">{location}</Text>
          </View>
        )}
      </SectionCard>

      <BankDetailsCard t={t} />
      <ReviewsCard profile={profile} t={t} />

      <NavRow icon="chart-line" iconColor="#16a34a" label={t('profitCalculator')} onPress={() => navigation.navigate('ProfitCalculator')} />
      <NavRow icon="finance" iconColor="#2563eb" label={t('financialForecast')} onPress={() => navigation.navigate('FinancialForecast')} />
      <NavRow icon="shield-check-outline" iconColor="#2563eb" label={t('kycVerification')} onPress={() => navigation.navigate('KycVerification')} />
      <NavRow icon="file-document-outline" iconColor="#7c3aed" label={t('supportTickets')} onPress={() => navigation.navigate('SupportTickets')} />
      <NavRow icon="lock-outline" iconColor="#ea580c" label={t('mpinSettings')} onPress={() => navigation.navigate('MpinSetup')} />

      <TouchableOpacity
        className="mx-4 mb-3 flex-row items-center justify-center rounded-2xl border border-red-200 bg-white py-4"
        onPress={handleLogout}
      >
        <Icon source="logout" size={18} color="#dc2626" />
        <Text className="ml-2 text-base font-bold text-red-600">{t('logout')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        className="mx-4 flex-row items-center justify-between rounded-2xl border border-red-200 bg-white px-4 py-4"
        onPress={handleDeleteAccount}
        disabled={deleteAccount.isPending}
      >
        <View className="flex-row items-center">
          <Icon source="trash-can-outline" size={18} color="#dc2626" />
          <Text className="ml-3 text-base font-bold text-red-600">{t('deleteAccountConfirmTitle')}</Text>
        </View>
        <Icon source="chevron-right" size={20} color="#f87171" />
      </TouchableOpacity>
    </ScrollView>
  );
}
