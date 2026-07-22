import { View, Text, ScrollView } from 'react-native';
import { Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useLanguage } from '../lib/i18n';

const STEPS = [
  { icon: '📦', titleKey: 'step1Title', descKey: 'step1Desc' },
  { icon: '⭐', titleKey: 'step2Title', descKey: 'step2Desc' },
  { icon: '📞', titleKey: 'step3Title', descKey: 'step3Desc' }
];

const FEATURES = ['feature1', 'feature2', 'feature3', 'feature4', 'feature5', 'feature6'];

export default function LandingScreen() {
  const navigation = useNavigation();
  const { language, setLanguage, t } = useLanguage();

  return (
    <ScrollView className="flex-1 bg-navy" contentContainerStyle={{ paddingBottom: 48 }}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pb-4 pt-14">
        <View className="flex-row items-center gap-2">
          <Text className="text-2xl">🚚</Text>
          <Text className="text-xl font-bold text-white">
            LOAD<Text className="text-brand">24</Text>
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <View className="flex-row rounded-full bg-white/10 p-1">
            <Button
              mode={language === 'hi' ? 'contained' : 'text'}
              compact
              textColor={language === 'hi' ? undefined : 'white'}
              onPress={() => setLanguage('hi')}
            >
              हिंदी
            </Button>
            <Button
              mode={language === 'en' ? 'contained' : 'text'}
              compact
              textColor={language === 'en' ? undefined : 'white'}
              onPress={() => setLanguage('en')}
            >
              EN
            </Button>
          </View>
        </View>
      </View>

      {/* Hero */}
      <View className="px-6 pb-8 pt-6">
        <Text className="mb-3 text-center text-3xl font-bold text-white">{t('tagline')}</Text>
        <Text className="mb-6 text-center text-sm text-slate-400">{t('heroSubtitle')}</Text>

        <Button mode="contained" buttonColor="#f97316" className="mb-3" onPress={() => navigation.navigate('AuthChoice')}>
          {t('ctaShipper')}
        </Button>
        <Button mode="outlined" textColor="#f97316" onPress={() => navigation.navigate('AuthChoice')}>
          {t('ctaTruckOwner')}
        </Button>

        <View className="mt-6 items-center">
          <Button mode="text" textColor="#f97316" onPress={() => navigation.navigate('AuthChoice')}>
            {t('signIn')}
          </Button>
        </View>
      </View>

      {/* How it works */}
      <View className="px-5 pb-8">
        <Text className="mb-5 text-center text-xl font-bold text-white">{t('howItWorksTitle')}</Text>
        {STEPS.map((step, i) => (
          <View key={step.titleKey} className="mb-4 rounded-2xl border border-brand/40 bg-navy-card p-5">
            <View className="mb-3 h-8 w-8 items-center justify-center rounded-full bg-brand">
              <Text className="font-bold text-white">{i + 1}</Text>
            </View>
            <Text className="mb-1 text-3xl">{step.icon}</Text>
            <Text className="mb-1 text-lg font-bold text-white">{t(step.titleKey)}</Text>
            <Text className="text-sm text-slate-400">{t(step.descKey)}</Text>
          </View>
        ))}
      </View>

      {/* Why LOAD24 */}
      <View className="px-5">
        <Text className="mb-5 text-center text-xl font-bold text-white">{t('whyTitle')}</Text>
        <View className="flex-row flex-wrap justify-between">
          {FEATURES.map((key) => (
            <View key={key} className="mb-3 w-[48%] rounded-xl bg-navy-card px-3 py-4">
              <Text className="text-sm text-slate-200">{t(key)}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
