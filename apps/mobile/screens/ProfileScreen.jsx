import { View, Text } from 'react-native';
import { Icon } from 'react-native-paper';
import { useLanguage } from '../lib/i18n';

// Placeholder — full profile view/edit lands in a later update.
export default function ProfileScreen() {
  const { t } = useLanguage();

  return (
    <View className="flex-1 items-center justify-center bg-white px-8">
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-orange-50">
        <Icon source="account-circle-outline" size={32} color="#f97316" />
      </View>
      <Text className="mb-2 text-center text-lg font-bold text-slate-900">Profile</Text>
      <Text className="text-center text-sm text-slate-500">{t('comingSoon')}</Text>
    </View>
  );
}
