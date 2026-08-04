import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { TextInput, Button, HelperText, Icon } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/i18n';
import { lookupPincode } from '../lib/pincodeLookup';
import { peekPostLoginIntent } from '../lib/postLoginIntent';

const ROLES = [
  { value: 'shipper', icon: 'package-variant-closed', titleKey: 'roleShipperTitle', descKey: 'roleShipperDesc' },
  { value: 'transporter', icon: 'office-building-outline', titleKey: 'roleTransporterTitle', descKey: 'roleTransporterDesc' },
  { value: 'broker', icon: 'account-outline', titleKey: 'roleBrokerTitle', descKey: 'roleBrokerDesc' },
  { value: 'vehicle_owner', icon: 'truck-outline', titleKey: 'roleVehicleOwnerTitle', descKey: 'roleVehicleOwnerDesc' },
  { value: 'driver', icon: 'account-outline', titleKey: 'roleDriverTitle', descKey: 'roleDriverDesc' }
];

function ProgressDots({ step }) {
  return (
    <View className="mb-6 flex-row items-center justify-center">
      {[0, 1].map((i) => (
        <View key={i} className="flex-row items-center">
          <View className={`h-3 w-3 rounded-full ${i <= step ? 'bg-brand' : 'bg-slate-300'}`} />
          {i === 0 && <View className="mx-1 h-px w-10 bg-slate-300" />}
        </View>
      ))}
    </View>
  );
}

function RoleCard({ role, selected, onPress, t }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`mb-3 flex-row items-center rounded-2xl border p-4 ${selected ? 'border-brand bg-orange-50' : 'border-slate-200 bg-white'}`}
    >
      <View className="mr-4 h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
        <Icon source={role.icon} size={22} color="#334155" />
      </View>
      <View className="flex-1">
        <Text className="text-base font-bold text-slate-800">{t(role.titleKey)}</Text>
        <Text className="text-sm text-slate-500">{t(role.descKey)}</Text>
      </View>
    </TouchableOpacity>
  );
}

// WhatsApp/phone-OTP signups have no real email — the backend mints a
// placeholder like wa919876543210@phone.load24.internal just so Supabase
// auth has an email identity. It was never entered or seen by the user, so
// it must not be shown as their (verified) email.
const isSyntheticEmail = (value) => !!value && value.endsWith('@phone.load24.internal');

export default function ProfileSetupScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const isVerifiedEmail = !!user?.email && !isSyntheticEmail(user.email);

  const [step, setStep] = useState(0); // 0: role, 1: basic info
  // Only relevant on first-time signup (profile doesn't exist yet, so
  // App.jsx's post-login-intent redirect hasn't fired/consumed it yet) —
  // editing an existing profile always starts with an empty pending intent.
  const [selectedRoles, setSelectedRoles] = useState(() =>
    peekPostLoginIntent() === 'truck' ? ['vehicle_owner'] : []
  );
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(() => (isSyntheticEmail(user?.email) ? '' : user?.email ?? ''));
  const [mobile, setMobile] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [pincode, setPincode] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [error, setError] = useState('');
  const [pincodeLoading, setPincodeLoading] = useState(false);

  useEffect(() => {
    if (pincode.trim().length !== 6) return;
    let cancelled = false;
    setPincodeLoading(true);
    lookupPincode(pincode.trim())
      .then((result) => {
        if (cancelled || !result) return;
        setCity(result.city);
        setState(result.state);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPincodeLoading(false); });
    return () => { cancelled = true; };
  }, [pincode]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      // Independent writes (different tables, no FK between them) — run
      // together instead of waiting on one before starting the other.
      await Promise.all([
        api.profile.save({
          full_name: fullName.trim(),
          mobile: mobile.trim(),
          user_type: selectedRoles[0],
          company_name: companyName.trim() || undefined,
          pincode: pincode.trim() || undefined,
          city: city.trim() || undefined,
          state: state.trim() || undefined,
          contact_email: !isVerifiedEmail ? email.trim() || undefined : undefined
        }),
        // Editing an existing profile re-submits the same role — the
        // backend rejects a role the user already holds (409), which isn't
        // a real failure here, just a no-op. Only genuine errors propagate.
        api.onboarding.selectRole(selectedRoles).catch((err) => {
          if (err.status !== 409) throw err;
        })
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      Alert.alert(t('profileSaved'), t('profileSavedMessage'), [
        { text: t('ok'), onPress: () => { if (navigation.canGoBack()) navigation.goBack(); } }
      ]);
    },
    onError: (err) => setError(err.message)
  });

  const selectRole = (value) => setSelectedRoles([value]);

  const handleSubmit = () => {
    setError('');
    if (!fullName.trim() || !mobile.trim()) return setError(t('fullName'));
    saveProfile.mutate();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-orange-50">
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 40 }}>
        <ProgressDots step={step} />

        {step === 0 ? (
          <>
            <Text className="mb-5 text-center text-2xl font-bold text-slate-900">{t('chooseRole')}</Text>
            {ROLES.map((role) => (
              <RoleCard
                key={role.value}
                role={role}
                selected={selectedRoles.includes(role.value)}
                onPress={() => selectRole(role.value)}
                t={t}
              />
            ))}
            <Button
              mode="contained"
              buttonColor="#f97316"
              className="mt-2"
              disabled={selectedRoles.length === 0}
              onPress={() => setStep(1)}
            >
              {t('next')}
            </Button>
          </>
        ) : (
          <>
            <Text className="mb-5 text-center text-2xl font-bold text-slate-900">{t('basicInfo')}</Text>
            <View className="rounded-2xl bg-white p-5">
              <Text className="mb-1 text-sm text-slate-600">{t('fullName')} *</Text>
              <TextInput mode="outlined" value={fullName} onChangeText={setFullName} className="mb-4" />

              <Text className="mb-1 text-sm text-slate-600">{t('email')}</Text>
              <TextInput
                mode="outlined"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
                editable={!isVerifiedEmail}
                left={<TextInput.Icon icon="email-outline" />}
                right={isVerifiedEmail ? <TextInput.Icon icon="check-decagram" color="#16a34a" /> : undefined}
                className="mb-1"
              />
              {isVerifiedEmail && <Text className="mb-4 text-xs text-green-600">✓ {t('emailVerified')}</Text>}
              {!isVerifiedEmail && <Text className="mb-4 text-xs text-slate-400">{t('emailOptional')}</Text>}

              <Text className="mb-1 text-sm text-slate-600">{t('mobileNumber')} *</Text>
              <TextInput
                mode="outlined"
                keyboardType="phone-pad"
                value={mobile}
                onChangeText={setMobile}
                left={<TextInput.Icon icon="phone-outline" />}
                className="mb-4"
              />

              <Text className="mb-1 text-sm text-slate-500">{t('companyNameOptional')}</Text>
              <TextInput
                mode="outlined"
                placeholder={t('companyNamePlaceholder')}
                value={companyName}
                onChangeText={setCompanyName}
                className="mb-4"
              />

              <View className="mb-4 flex-row gap-3">
                <View className="flex-1">
                  <Text className="mb-1 text-sm text-slate-600">{t('pincode')}</Text>
                  <TextInput
                    mode="outlined"
                    keyboardType="number-pad"
                    maxLength={6}
                    value={pincode}
                    onChangeText={setPincode}
                    right={pincodeLoading ? <TextInput.Icon icon={() => <ActivityIndicator size={16} color="#f97316" />} /> : undefined}
                  />
                </View>
                <View className="flex-1">
                  <Text className="mb-1 text-sm text-slate-600">{t('city')}</Text>
                  <TextInput mode="outlined" value={city} onChangeText={setCity} />
                </View>
              </View>

              <Text className="mb-1 text-sm text-slate-600">{t('state')}</Text>
              <TextInput mode="outlined" value={state} onChangeText={setState} />
            </View>

            <HelperText type="error" visible={!!error}>{error}</HelperText>

            <View className="mt-2 flex-row gap-3">
              <Button mode="outlined" className="flex-1" onPress={() => setStep(0)}>
                {t('back')}
              </Button>
              <Button
                mode="contained"
                buttonColor="#f97316"
                className="flex-1"
                loading={saveProfile.isPending}
                disabled={saveProfile.isPending || !fullName.trim() || !mobile.trim()}
                onPress={handleSubmit}
              >
                {t('saveAndContinue')}
              </Button>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
