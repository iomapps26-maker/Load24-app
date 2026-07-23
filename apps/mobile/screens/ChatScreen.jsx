import { View, Text } from 'react-native';
import { Icon } from 'react-native-paper';
import { useLanguage } from '../lib/i18n';

// Placeholder — real agent chat lands in a later update.
export default function ChatScreen() {
  const { t } = useLanguage();

  return (
    <View className="flex-1 items-center justify-center bg-white px-8">
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <Icon source="chat-outline" size={30} color="#16a34a" />
      </View>
      <Text className="mb-2 text-center text-lg font-bold text-slate-900">{t('supportChat')}</Text>
      <Text className="text-center text-sm text-slate-500">{t('comingSoon')}</Text>
    </View>
  );
}
