import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Icon } from 'react-native-paper';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { TRUCK_TYPE_LABELS } from '../lib/loadOptions';
import { confirmSubmit } from '../lib/confirmSubmit';

// Bids move in ₹500 steps off the asking price rather than free typing — a
// faster, thumb-friendly way to counter-offer than the keyboard.
const BID_STEP = 500;

// "Today"/"Tomorrow" reads faster than a bare date on a bidding screen —
// mirrors the same helper in LoadRouteSummary.
function loadingWhenLabel(dateStr, t) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  if (diffDays === 0) return t('today');
  if (diffDays === 1) return t('tomorrow');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

// Unloading gets a plain "7 August" — unlike loading time it's an estimate
// days out, not a same-day appointment, so "Today"/"Tomorrow" doesn't apply.
function unloadingDateLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
}

function RoutePoint({ color, icon, title, address }) {
  return (
    <View className="flex-row items-start">
      <View className="mr-3 mt-0.5 h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: color }}>
        <Icon source={icon} size={14} color="#ffffff" />
      </View>
      <View className="flex-1">
        <Text className="text-base font-bold text-slate-900">{title}</Text>
        {!!address && (
          <Text className="mt-1 text-xs uppercase leading-5 text-slate-400">{address}</Text>
        )}
      </View>
    </View>
  );
}

// Full-page bid entry, opened from LoadCard's "Let's Bidding" button — replaces
// the old bottom-sheet BidModal. Shows the whole load (route, distance,
// loading time, required truck) with a step-by-500 rate picker pinned to the
// bottom so a bidder can review everything before committing.
export default function PlaceBidScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { language, t } = useLanguage();
  const { load } = route.params;

  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: api.profile.me });

  const basePrice = Math.round((Number(load.bhada_price) || 0) / BID_STEP) * BID_STEP;
  const [amount, setAmount] = useState(basePrice || BID_STEP);
  const [error, setError] = useState('');

  const bidMutation = useMutation({
    mutationFn: () => api.loadBids.place({ load_id: load.id, amount, bid_by_type: profile?.user_type }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myBids'] });
      queryClient.invalidateQueries({ queryKey: ['loads'] });
      navigation.goBack();
    },
    onError: (err) => setError(err.message)
  });

  const truckTypeLabel =
    load.required_truck_type === 'other'
      ? load.required_truck_type_other || t('other')
      : TRUCK_TYPE_LABELS[language]?.[load.required_truck_type] ?? load.required_truck_type;

  const loadingWhen = loadingWhenLabel(load.loading_date, t);
  const unloadingWhen = unloadingDateLabel(load.unloading_date);
  const adjust = (delta) => setAmount((a) => Math.max(BID_STEP, a + delta));

  return (
    <View className="flex-1 bg-slate-50">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 220 }}>
        <View className="mb-4 rounded-3xl border border-slate-100 bg-white p-5">
          <RoutePoint color="#16a34a" icon="arrow-up" title={load.loading_city || load.loading_pincode} address={load.loading_address} />
          <View className="my-2 ml-3 h-6 border-l border-dashed border-slate-300" />
          <RoutePoint color="#dc2626" icon="arrow-down" title={load.unloading_city || load.unloading_pincode} address={load.unloading_address} />

          {!!load.distance_km && (
            <View className="mt-4 flex-row items-center gap-2 rounded-xl bg-slate-50 px-4 py-3">
              <Icon source="arrow-left-right" size={16} color="#475569" />
              <Text className="text-sm font-semibold text-slate-700">{t('tripDistance')} {load.distance_km} KM</Text>
            </View>
          )}
        </View>

        {(!!load.loading_time || !!unloadingWhen) && (
          <View className="mb-4 flex-row items-stretch rounded-3xl border border-slate-100 bg-white p-5">
            {!!load.loading_time && (
              <View className="flex-1 items-center">
                <Icon source="clock-outline" size={22} color="#334155" />
                <Text className="mt-2 text-base font-bold text-slate-900">{loadingWhen} {load.loading_time}</Text>
                <Text className="text-xs text-slate-400">{t('loadingTime')}</Text>
              </View>
            )}
            {!!load.loading_time && !!unloadingWhen && <View className="w-px bg-slate-100" />}
            {!!unloadingWhen && (
              <View className="flex-1 items-center">
                <Icon source="calendar-blank-outline" size={22} color="#334155" />
                <Text className="mt-2 text-base font-bold text-slate-900">{unloadingWhen}</Text>
                <Text className="text-xs text-slate-400">{t('unloading')}</Text>
              </View>
            )}
          </View>
        )}

        <View className="mb-4 flex-row items-center gap-4 rounded-3xl border border-slate-100 bg-white p-5">
          <View className="h-16 w-16 items-center justify-center rounded-2xl bg-orange-50">
            <Icon source="truck-outline" size={32} color="#f97316" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-bold text-slate-900">
              {truckTypeLabel}{load.truck_length_ft ? ` · ${load.truck_length_ft} Ft` : ''}
            </Text>
            {!!load.weight_tons && (
              <Text className="text-xs text-slate-400">{t('goods')} {Number(load.weight_tons).toFixed(1)} {t('ton')}</Text>
            )}
          </View>
        </View>
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 rounded-t-3xl border border-slate-100 bg-white p-5 pb-8">
        <View className="mb-3 flex-row items-center justify-between rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
          <TouchableOpacity
            onPress={() => adjust(-BID_STEP)}
            className="h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white"
          >
            <Text className="text-xl font-bold text-slate-700">−</Text>
          </TouchableOpacity>
          <Text className="text-2xl font-extrabold text-slate-900">₹ {amount.toLocaleString('en-IN')}</Text>
          <TouchableOpacity
            onPress={() => adjust(BID_STEP)}
            className="h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white"
          >
            <Text className="text-xl font-bold text-slate-700">+</Text>
          </TouchableOpacity>
        </View>

        {amount === basePrice && (
          <Text className="mb-3 text-center text-sm font-semibold text-green-700">🏆 {t('winBidInstantly')}</Text>
        )}

        {!!error && <Text className="mb-3 text-center text-sm text-red-600">{error}</Text>}

        <TouchableOpacity
          onPress={() => confirmSubmit(t, () => bidMutation.mutate())}
          disabled={bidMutation.isPending || amount <= 0}
          className="items-center rounded-2xl bg-green-600 py-4"
          style={bidMutation.isPending ? { opacity: 0.6 } : undefined}
        >
          <Text className="text-base font-bold text-white">{t('confirmThisRate')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
