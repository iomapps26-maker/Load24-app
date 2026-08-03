import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { TextInput, Button, HelperText, Icon, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/i18n';

function IdentityRow({ icon, iconColor, label, linked, detail, t, children }) {
  return (
    <View className="mx-4 mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          <Icon source={icon} size={20} color={iconColor} />
          <View className="ml-3">
            <Text className="text-base font-semibold text-slate-800">{label}</Text>
            {detail ? <Text className="text-sm text-slate-500">{detail}</Text> : null}
          </View>
        </View>
        {linked ? (
          <View className="flex-row items-center rounded-full bg-green-100 px-3 py-1">
            <Icon source="check-circle" size={14} color="#16a34a" />
            <Text className="ml-1 text-xs font-semibold text-green-700">{t('linked')}</Text>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export default function LinkedAccountsScreen() {
  const { linkGoogleIdentity, sendLinkPhoneOtp, verifyLinkPhoneOtp, getLinkedIdentities } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const { data: identities, isLoading, refetch } = useQuery({
    queryKey: ['linkedIdentities'],
    queryFn: getLinkedIdentities
  });

  // The Google-link round-trip leaves the app and comes back via a deep
  // link (same pattern as sign-in) rather than a promise this screen can
  // await, so re-check identities whenever this screen regains focus.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState('');

  const handleLinkGoogle = async () => {
    setGoogleError('');
    setGoogleLoading(true);
    const { error } = await linkGoogleIdentity();
    setGoogleLoading(false);
    if (error) setGoogleError(error.message);
  };

  const [phoneMode, setPhoneMode] = useState('entry'); // 'entry' | 'otp'
  const [phone, setPhone] = useState('');
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [phoneInfo, setPhoneInfo] = useState('');
  const [phoneLoading, setPhoneLoading] = useState(false);

  const handleSendPhoneOtp = async () => {
    setPhoneError('');
    setPhoneLoading(true);
    const { error } = await sendLinkPhoneOtp(phone.trim());
    setPhoneLoading(false);
    if (error) return setPhoneError(error.message);
    setPhoneMode('otp');
  };

  const handleVerifyPhoneOtp = async () => {
    setPhoneError('');
    setPhoneLoading(true);
    const { error } = await verifyLinkPhoneOtp(phone.trim(), phoneOtp.trim());
    setPhoneLoading(false);
    if (error) return setPhoneError(error.message);
    setPhoneInfo(t('phoneLinkedSuccess'));
    setPhoneMode('entry');
    setPhone('');
    setPhoneOtp('');
    queryClient.invalidateQueries({ queryKey: ['linkedIdentities'] });
    queryClient.invalidateQueries({ queryKey: ['profile'] });
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ paddingVertical: 16 }}>
      <Text className="mx-4 mb-4 text-sm text-slate-500">{t('linkedAccountsDesc')}</Text>

      <IdentityRow
        icon="google"
        iconColor="#ea4335"
        label={t('googleAccount')}
        linked={identities?.google_linked}
        detail={identities?.google_linked ? identities?.email : null}
        t={t}
      >
        {!identities?.google_linked && (
          <>
            <Button
              mode="outlined"
              className="mt-3"
              icon="google"
              loading={googleLoading}
              disabled={googleLoading}
              onPress={handleLinkGoogle}
            >
              {t('linkGoogle')}
            </Button>
            <HelperText type="error" visible={!!googleError}>{googleError}</HelperText>
          </>
        )}
      </IdentityRow>

      <IdentityRow
        icon="whatsapp"
        iconColor="#25D366"
        label={t('phoneNumber')}
        linked={identities?.phone_linked}
        detail={identities?.phone_linked ? identities?.phone : null}
        t={t}
      >
        {!identities?.phone_linked && (
          <View className="mt-3">
            {phoneMode === 'entry' ? (
              <>
                <TextInput
                  mode="outlined"
                  placeholder="98765 43210"
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={setPhone}
                  left={<TextInput.Icon icon="whatsapp" />}
                  dense
                />
                <HelperText type="info" visible={!phoneError}>{t('enterMobileToLink')}</HelperText>
                <HelperText type="error" visible={!!phoneError}>{phoneError}</HelperText>
                <Button
                  mode="outlined"
                  loading={phoneLoading}
                  disabled={!phone || phoneLoading}
                  onPress={handleSendPhoneOtp}
                >
                  {t('linkPhone')}
                </Button>
              </>
            ) : (
              <>
                <Text className="mb-2 text-sm text-slate-500">
                  {t('linkPhoneVerifyDesc')} {phone}
                </Text>
                <TextInput
                  mode="outlined"
                  keyboardType="number-pad"
                  value={phoneOtp}
                  onChangeText={setPhoneOtp}
                  left={<TextInput.Icon icon="shield-key-outline" />}
                  dense
                />
                <HelperText type="error" visible={!!phoneError}>{phoneError}</HelperText>
                <Button
                  mode="contained"
                  buttonColor="#25D366"
                  loading={phoneLoading}
                  disabled={!phoneOtp || phoneLoading}
                  onPress={handleVerifyPhoneOtp}
                >
                  {t('verifyAndLink')}
                </Button>
                <TouchableOpacity className="mt-2 items-center" onPress={() => setPhoneMode('entry')}>
                  <Text className="text-sm text-slate-500">{t('back')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </IdentityRow>

      <HelperText type="info" visible={!!phoneInfo} style={{ marginHorizontal: 16 }}>
        {phoneInfo}
      </HelperText>
    </ScrollView>
  );
}
