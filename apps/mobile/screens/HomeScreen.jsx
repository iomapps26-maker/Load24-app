import { useCallback, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Linking } from 'react-native';
import { Icon } from 'react-native-paper';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/i18n';

const STEPS = [
  { icon: '📦', titleKey: 'step1Title', descKey: 'step1Desc' },
  { icon: '⭐', titleKey: 'step2Title', descKey: 'step2Desc' },
  { icon: '📞', titleKey: 'step3Title', descKey: 'step3Desc' }
];

const FEATURES = ['feature1', 'feature2', 'feature3', 'feature4', 'feature5', 'feature6'];

const STAGES = ['posted', 'matched', 'transit', 'complete'];
const STAGE_INDEX = { active: 0, matched: 1, in_transit: 2, completed: 3, cancelled: 0, expired: 0 };

function notImplemented(t) {
  Alert.alert(t('comingSoon'));
}

function StatCard({ icon, iconBg, value, label }) {
  return (
    <View className="mb-3 w-[48%] rounded-2xl border border-slate-200 bg-white p-4">
      <View className={`mb-3 h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}>
        <Icon source={icon} size={18} color="white" />
      </View>
      <Text className="text-2xl font-bold text-slate-900">{value}</Text>
      <Text className="text-sm text-slate-500">{label}</Text>
    </View>
  );
}

function RecentLoadCard({ load, t }) {
  const stageIndex = STAGE_INDEX[load.status] ?? 0;
  return (
    <View className="mb-3 rounded-2xl border border-slate-200 bg-white p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-2">
          <View className="flex-row items-center flex-wrap">
            <Text className="text-base font-bold text-slate-900">
              {load.loading_city || load.loading_pincode} → {load.unloading_city || load.unloading_pincode}
            </Text>
          </View>
          <View className="mt-1 self-start rounded-full bg-green-100 px-2 py-0.5">
            <Text className="text-xs font-semibold text-green-700">{t('statusActive')}</Text>
          </View>
          <Text className="mt-2 text-sm text-slate-500">
            {load.material_type} • {load.weight_tons} Ton • ₹{Number(load.bhada_price).toLocaleString('en-IN')}
          </Text>
        </View>
        <View className="items-end">
          <TouchableOpacity
            className="mb-2 rounded-lg border border-slate-300 px-3 py-1.5"
            onPress={() => notImplemented(t)}
          >
            <Text className="text-xs font-semibold text-slate-700">{t('view')}</Text>
          </TouchableOpacity>
          <TouchableOpacity className="rounded-lg bg-brand px-3 py-1.5" onPress={() => notImplemented(t)}>
            <Text className="text-xs font-semibold text-white">{t('chat')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View className="mt-3 h-1 flex-row overflow-hidden rounded-full bg-slate-200">
        <View className="h-1 bg-slate-900" style={{ width: `${((stageIndex + 1) / STAGES.length) * 100}%` }} />
      </View>
      <View className="mt-1 flex-row justify-between">
        {STAGES.map((s, i) => (
          <Text key={s} className={`text-[10px] ${i <= stageIndex ? 'text-slate-700' : 'text-slate-400'}`}>
            {t(`stage${s.charAt(0).toUpperCase()}${s.slice(1)}`)}
          </Text>
        ))}
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const navigation = useNavigation();
  const { signOut } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const scrollRef = useRef(null);
  const [summaryY, setSummaryY] = useState(0);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: myLoads = [] } = useQuery({ queryKey: ['myLoads'], queryFn: api.loads.mine });
  const { data: recentLoads = [] } = useQuery({
    queryKey: ['recentLoads'],
    queryFn: () => api.loads.list({ limit: 5 })
  });

  // Bottom-tab screens stay mounted on tab switch, so React Query's
  // refetch-on-mount never fires again after the first visit — without this,
  // the summary would only ever reflect loads as of app launch.
  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['myLoads'] });
      queryClient.invalidateQueries({ queryKey: ['recentLoads'] });
    }, [queryClient])
  );

  const stats = {
    active: myLoads.filter((l) => l.status === 'active').length,
    processing: myLoads.filter((l) => ['matched', 'in_transit'].includes(l.status)).length,
    completed: myLoads.filter((l) => l.status === 'completed').length,
    total: myLoads.length
  };

  const handleSignOut = () => {
    Alert.alert(t('signOut'), '', [
      { text: t('back'), style: 'cancel' },
      { text: t('signOut'), style: 'destructive', onPress: signOut }
    ]);
  };

  return (
    <ScrollView ref={scrollRef} className="flex-1 bg-white">
      {/* Header */}
      <View
        className="flex-row items-center justify-between border-b border-slate-100 px-4 pb-3"
        style={{ paddingTop: insets.top + 12 }}
      >
        <View className="flex-row items-center gap-2">
          <Text className="text-2xl">🚚</Text>
          <Text className="text-lg font-bold text-navy">
            LOAD<Text className="text-brand">24</Text>
          </Text>
        </View>
        <View className="flex-row items-center gap-1">
          <TouchableOpacity className="h-9 w-9 items-center justify-center rounded-lg bg-slate-100" onPress={() => navigation.navigate('Wallet')}>
            <Icon source="wallet-outline" size={18} color="#334155" />
          </TouchableOpacity>
          <TouchableOpacity className="h-9 w-9 items-center justify-center rounded-lg bg-slate-100" onPress={handleSignOut}>
            <Icon source="account-outline" size={18} color="#334155" />
          </TouchableOpacity>
          <TouchableOpacity className="h-9 w-9 items-center justify-center rounded-lg bg-slate-100" onPress={() => notImplemented(t)}>
            <Icon source="bell-outline" size={18} color="#334155" />
          </TouchableOpacity>
          <TouchableOpacity
            className="rounded-full bg-slate-100 px-3 py-2"
            onPress={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
          >
            <Text className="text-xs font-semibold text-slate-700">{language === 'hi' ? 'हिंदी' : 'EN'}</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View className="border-b border-slate-100 px-4 pb-3 pt-2">
        <TouchableOpacity
          className="items-center rounded-xl bg-brand py-2.5"
          onPress={() => scrollRef.current?.scrollTo({ y: summaryY, animated: true })}
        >
          <Text className="text-sm font-bold text-white">{t('goToDashboard')}</Text>
        </TouchableOpacity>
      </View>

      {/* Hero */}
      <View className="bg-orange-50 px-6 pb-8 pt-8">
        <Text className="mb-3 text-center text-2xl font-bold text-slate-900">{t('tagline')}</Text>
        <Text className="mb-6 text-center text-sm text-slate-500">{t('heroSubtitle')}</Text>

        <TouchableOpacity
          className="mb-3 flex-row items-center justify-center rounded-xl bg-brand py-3.5"
          onPress={() => navigation.navigate('Create')}
        >
          <Text className="mr-2 text-base font-bold text-white">{t('ctaShipper')}</Text>
          <Icon source="arrow-right" size={18} color="white" />
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-row items-center justify-center rounded-xl border-2 border-brand py-3.5"
          onPress={() => navigation.navigate('Loads')}
        >
          <Text className="mr-2 text-base font-bold text-brand">{t('ctaTruckOwner')}</Text>
          <Icon source="arrow-right" size={18} color="#f97316" />
        </TouchableOpacity>
      </View>

      {/* Loads summary */}
      <View className="px-4 pt-6" onLayout={(e) => setSummaryY(e.nativeEvent.layout.y)}>
        <View className="mb-4 flex-row items-center justify-between">
          <Text className="text-xl font-bold text-slate-900">{t('yourLoadsSummary')}</Text>
          <TouchableOpacity className="rounded-lg bg-brand px-3 py-2" onPress={() => navigation.navigate('Create')}>
            <Text className="text-xs font-bold text-white">+ {t('postNewLoad')}</Text>
          </TouchableOpacity>
        </View>
        <View className="flex-row flex-wrap justify-between">
          <StatCard icon="package-variant-closed" iconBg="bg-green-500" value={stats.active} label={t('statusActive')} />
          <StatCard icon="clock-outline" iconBg="bg-brand" value={stats.processing} label={t('statusProcessing')} />
          <StatCard icon="check-circle-outline" iconBg="bg-blue-500" value={stats.completed} label={t('statusCompleted')} />
          <StatCard icon="trending-up" iconBg="bg-purple-500" value={stats.total} label={t('statusTotalLoads')} />
        </View>
      </View>

      {/* Recent loads */}
      {recentLoads.length > 0 && (
        <View className="px-4 pt-2">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-xl font-bold text-slate-900">{t('recentLoads')}</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Loads')}>
              <Text className="text-sm font-semibold text-brand">{t('viewAll')} →</Text>
            </TouchableOpacity>
          </View>
          {recentLoads.slice(0, 5).map((load) => (
            <RecentLoadCard key={load.id} load={load} t={t} />
          ))}
          <TouchableOpacity
            className="mb-2 items-center rounded-xl border border-brand py-3"
            onPress={() => navigation.navigate('Loads')}
          >
            <Text className="text-sm font-bold text-brand">{t('viewMoreLoads')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* How it works */}
      <View className="px-5 pb-2 pt-8">
        <Text className="mb-5 text-center text-xl font-bold text-slate-900">{t('howItWorksTitle')}</Text>
        {STEPS.map((step, i) => (
          <View key={step.titleKey} className="mb-4 items-center rounded-2xl border border-orange-200 bg-orange-50 p-5">
            <View className="mb-3 h-8 w-8 items-center justify-center rounded-full bg-brand self-start">
              <Text className="font-bold text-white">{i + 1}</Text>
            </View>
            <Text className="mb-2 text-3xl">{step.icon}</Text>
            <Text className="mb-1 text-base font-bold text-slate-900">{t(step.titleKey)}</Text>
            <Text className="text-center text-sm text-slate-500">{t(step.descKey)}</Text>
            <TouchableOpacity onPress={() => notImplemented(t)}>
              <Text className="mt-2 text-sm font-semibold text-brand">{t('learnMore')} →</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      {/* Why LOAD24 */}
      <View className="px-5 pb-8">
        <Text className="mb-5 text-center text-xl font-bold text-slate-900">{t('whyTitle')}</Text>
        <View className="flex-row flex-wrap justify-between">
          {FEATURES.map((key) => (
            <View key={key} className="mb-3 w-[48%] flex-row items-center rounded-xl bg-slate-50 px-3 py-4">
              <View className="mr-2 h-8 w-8 items-center justify-center rounded-full bg-green-100">
                <Icon source="check" size={16} color="#16a34a" />
              </View>
              <Text className="flex-1 text-sm text-slate-700">{t(key)}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Staff portal */}
      <View className="bg-navy px-6 py-10">
        <View className="mb-4 self-start rounded-full bg-brand/20 px-3 py-1">
          <Text className="text-xs font-bold text-brand">🛡 {t('staffPortal')}</Text>
        </View>
        <Text className="mb-2 text-2xl font-bold text-white">{t('staffLoginTitle')}</Text>
        <Text className="mb-5 text-sm text-slate-400">{t('staffLoginDesc')}</Text>

        <TouchableOpacity
          className="mb-4 flex-row items-center justify-center rounded-xl bg-brand py-3.5"
          onPress={() => notImplemented(t)}
        >
          <Icon source="shield-outline" size={18} color="white" />
          <Text className="ml-2 text-base font-bold text-white">{t('loginAsEmployee')}</Text>
        </TouchableOpacity>

        {[
          { icon: 'account-group-outline', key: 'viewAssignedClients' },
          { icon: 'package-variant-closed', key: 'trackAssignedLoads' },
          { icon: 'star-outline', key: 'manageLikesLeads' }
        ].map((item) => (
          <TouchableOpacity
            key={item.key}
            className="mb-3 items-center rounded-xl border border-slate-700 py-4"
            onPress={() => notImplemented(t)}
          >
            <Icon source={item.icon} size={20} color="#94a3b8" />
            <Text className="mt-2 text-sm text-slate-300">{t(item.key)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Payment details */}
      <View className="bg-slate-50 px-5 py-10">
        <Text className="mb-5 text-center text-2xl font-bold text-navy">{t('paymentDetails')}</Text>

        <View className="mb-4 rounded-2xl border border-orange-200 bg-white p-5">
          <View className="mb-3 flex-row items-center">
            <View className="mr-2 h-8 w-8 items-center justify-center rounded-full bg-orange-100">
              <Icon source="qrcode" size={18} color="#f97316" />
            </View>
            <Text className="text-base font-bold text-slate-900">{t('upiPayment')}</Text>
          </View>

          <View className="flex-row">
            <View className="flex-1 pr-3">
              <Text className="text-xs text-slate-400">UPI ID</Text>
              <Text className="mb-2 text-sm font-semibold text-brand">internationalonlinemedia@icici</Text>
              <Text className="text-xs text-slate-400">{t('merchantName')}</Text>
              <Text className="text-sm font-semibold text-slate-800">INTERNATIONAL ONLINE MEDIA</Text>
            </View>
            <View className="items-center justify-center rounded-lg border border-slate-200 p-2">
              <Icon source="qrcode" size={56} color="#334155" />
              <TouchableOpacity onPress={() => notImplemented(t)}>
                <Text className="mt-1 text-xs font-semibold text-brand">↓ {t('download')}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View className="mt-4 flex-row flex-wrap gap-2">
            <View className="rounded-full bg-purple-600 px-4 py-2"><Text className="text-xs font-bold text-white">PhonePe</Text></View>
            <View className="rounded-full border border-slate-300 px-4 py-2"><Text className="text-xs font-bold text-slate-700">GPay</Text></View>
            <View className="rounded-full bg-blue-600 px-4 py-2"><Text className="text-xs font-bold text-white">Paytm</Text></View>
            <View className="rounded-full bg-brand px-4 py-2"><Text className="text-xs font-bold text-white">BHIM/UPI</Text></View>
          </View>
          <Text className="mt-3 text-xs text-green-700">✓ {t('allUpiAppsAccepted')}</Text>
        </View>

        <View className="rounded-2xl border border-slate-200 bg-white p-5">
          <View className="mb-3 flex-row items-center">
            <View className="mr-2 h-8 w-8 items-center justify-center rounded-full bg-blue-100">
              <Icon source="bank-outline" size={18} color="#2563eb" />
            </View>
            <Text className="text-base font-bold text-slate-900">{t('bankAccount')}</Text>
          </View>
          <Text className="text-xs text-slate-400">{t('accountName')}</Text>
          <Text className="mb-2 text-sm font-semibold text-slate-800">INTERNATIONAL ONLINE MEDIA</Text>
          <Text className="text-xs text-slate-400">{t('accountNumber')}</Text>
          <Text className="mb-2 text-sm font-semibold text-blue-600">003105501891</Text>
          <View className="flex-row justify-between">
            <View>
              <Text className="text-xs text-slate-400">{t('ifscCode')}</Text>
              <Text className="text-sm font-semibold text-slate-800">ICIC0000031</Text>
            </View>
            <View>
              <Text className="text-xs text-slate-400">{t('bank')}</Text>
              <Text className="text-sm font-semibold text-slate-800">ICICI BANK</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Support */}
      <View className="items-center bg-green-600 px-6 py-10">
        <View className="mb-3 flex-row items-center rounded-full bg-white/20 px-3 py-1">
          <Text className="text-xs font-bold text-white">🟢 {t('allIndiaServices')}</Text>
        </View>
        <Text className="mb-5 text-center text-xl font-bold text-white">{t('needHelp')}</Text>
        <TouchableOpacity
          className="mb-3 w-full flex-row items-center justify-center rounded-xl bg-green-800 py-3.5"
          onPress={() => Linking.openURL('tel:').catch(() => notImplemented(t))}
        >
          <Icon source="phone" size={18} color="white" />
          <Text className="ml-2 text-base font-bold text-white">{t('callSalesTeam')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="w-full flex-row items-center justify-center rounded-xl bg-white py-3.5"
          onPress={() => notImplemented(t)}
        >
          <Icon source="chat-outline" size={18} color="#166534" />
          <Text className="ml-2 text-base font-bold text-green-800">{t('chatWithUs')}</Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View className="items-center bg-navy px-6 py-10">
        <View className="mb-2 flex-row items-center gap-2">
          <Text className="text-xl">🚚</Text>
          <Text className="text-lg font-bold text-white">LOAD24.in</Text>
        </View>
        <View className="mb-3 rounded-full bg-green-500/20 px-3 py-1">
          <Text className="text-xs font-bold text-green-400">🟢 {t('allIndiaServices')}</Text>
        </View>
        <Text className="mb-3 text-center text-xs text-slate-400">{t('allLanguagesSupport')}</Text>
        <Text className="mb-4 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} LOAD24. {t('allRightsReserved')}
        </Text>
        <View className="flex-row flex-wrap items-center justify-center gap-3">
          <TouchableOpacity onPress={() => notImplemented(t)}>
            <Text className="text-xs text-slate-400">{t('deleteAccount')}</Text>
          </TouchableOpacity>
          <Text className="text-xs text-slate-600">|</Text>
          <TouchableOpacity onPress={() => notImplemented(t)}>
            <Text className="text-xs text-brand">{t('privacyPolicy')}</Text>
          </TouchableOpacity>
          <Text className="text-xs text-slate-600">|</Text>
          <TouchableOpacity onPress={() => notImplemented(t)}>
            <Text className="text-xs text-brand">{t('termsOfService')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}
