import { View, Text, ScrollView } from 'react-native';
import { Icon } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../lib/i18n';

// Bulleted list under one heading — refunded / forfeited reasons are each
// their own i18n key (house convention: flat string keys, no arrays) so a
// point is picked out one at a time here rather than split on the client.
function PolicyList({ icon, iconColor, title, points, t }) {
  return (
    <View className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
      <View className="mb-3 flex-row items-center">
        <Icon source={icon} size={20} color={iconColor} />
        <Text className="ml-2 text-base font-bold text-slate-900">{title}</Text>
      </View>
      {points.map((key) => (
        <View key={key} className="mb-2 flex-row items-start">
          <Text className="mr-2 text-sm text-slate-400">•</Text>
          <Text className="flex-1 text-sm text-slate-700">{t(key)}</Text>
        </View>
      ))}
    </View>
  );
}

const REFUNDED_POINT_KEYS = [
  'tokenRefundedPoint1',
  'tokenRefundedPoint2',
  'tokenRefundedPoint3',
  'tokenRefundedPoint4',
  'tokenRefundedPoint5'
];

const FORFEITED_POINT_KEYS = [
  'tokenForfeitedPoint1',
  'tokenForfeitedPoint2',
  'tokenForfeitedPoint3',
  'tokenForfeitedPoint4',
  'tokenForfeitedPoint5',
  'tokenForfeitedPoint6',
  'tokenForfeitedPoint7'
];

export default function TokenRefundPolicyScreen() {
  const { t } = useLanguage();
  // No bottom tab bar on this pushed screen — see HomeScreen/TripDetails —
  // so the last card needs its own clearance from the Android nav bar.
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      className="flex-1 bg-slate-50 px-4 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) + 12 }}
    >
      <View className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <View className="mb-2 flex-row items-center">
          <Icon source="cash-refund" size={20} color="#f97316" />
          <Text className="ml-2 text-base font-bold text-slate-900">{t('tokenWhyImportantTitle')}</Text>
        </View>
        <Text className="text-sm text-slate-700">{t('tokenWhyImportantBody')}</Text>
      </View>

      <PolicyList
        icon="check-circle-outline"
        iconColor="#16a34a"
        title={t('tokenRefundedTitle')}
        points={REFUNDED_POINT_KEYS}
        t={t}
      />

      <PolicyList
        icon="close-circle-outline"
        iconColor="#dc2626"
        title={t('tokenForfeitedTitle')}
        points={FORFEITED_POINT_KEYS}
        t={t}
      />

      <View className="mb-3 rounded-2xl border border-orange-200 bg-orange-50 p-4">
        <Text className="text-xs text-orange-800">{t('tokenRefundNote1')}</Text>
      </View>

      <View className="mb-3 rounded-2xl border border-slate-200 bg-white p-4">
        <Text className="text-xs text-slate-500">{t('tokenRefundNote2')}</Text>
      </View>
    </ScrollView>
  );
}
