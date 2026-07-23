import { View, Text } from 'react-native';
import { Icon } from 'react-native-paper';
import { useLanguage } from '../lib/i18n';

// Placeholder — the forecast logic isn't specified yet.
export default function FinancialForecastScreen() {
  const { t } = useLanguage();

  return (
    <View className="flex-1 items-center justify-center bg-white px-8">
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-blue-50">
        <Icon source="finance" size={32} color="#2563eb" />
      </View>
      <Text className="mb-2 text-center text-lg font-bold text-slate-900">{t('financialForecast')}</Text>
      <Text className="text-center text-sm text-slate-500">{t('comingSoonFeature')}</Text>
    </View>
  );
}
