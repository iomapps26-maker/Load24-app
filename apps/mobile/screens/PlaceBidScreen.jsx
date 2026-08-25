import { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Icon } from 'react-native-paper';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { TRUCK_TYPE_LABELS } from '../lib/loadOptions';
import ConfirmDetailsCheckbox from '../components/ConfirmDetailsCheckbox';

// Bidding with a specific truck is optional (brokers/transporters often bid
// without one), so this is a compact chip row rather than the full required
// picker PostTruckScreen uses. Selecting one is what lets the backend flip
// that truck's truck_availabilities posting to 'booked' once the bid is
// approved (see loadBids.js's /:id/approve) — omitted here, that update
// never fires and the truck keeps surfacing as available.
function TruckChips({ trucks, selectedId, onSelect, t }) {
  if (!trucks?.length) return null;
  return (
    <View className="mb-3">
      <Text className="mb-2 text-xs text-slate-500">{t('bidWithTruck')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2">
          {trucks.map((truck) => (
            <TouchableOpacity
              key={truck.id}
              onPress={() => onSelect(selectedId === truck.id ? null : truck.id)}
              className={`flex-row items-center rounded-full border px-3 py-2 ${
                selectedId === truck.id ? 'border-brand bg-orange-50' : 'border-slate-200 bg-white'
              }`}
            >
              <Icon source="truck-outline" size={14} color={selectedId === truck.id ? '#f97316' : '#334155'} />
              <Text className="ml-1.5 text-xs font-semibold text-slate-800">{truck.registration_number}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

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

// Full-page bid entry, opened either from LoadCard's "Let's Bidding" button
// (which already has the whole load object on hand) or from a WhatsApp
// "View Load"/"Bid" deep link (App.jsx's Linking handling — loads/:loadId),
// which only carries an id. Shows the whole load (route, distance, loading
// time, required truck) with a step-by-500 rate picker pinned to the bottom
// so a bidder can review everything before committing.
export default function PlaceBidScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { language, t } = useLanguage();
  const { load: loadParam, loadId } = route.params;

  // Only fires for the deep-link entry point — LoadCard's in-app navigation
  // already passes the full load object, so there's nothing to fetch there.
  const { data: fetchedLoad, isLoading: isLoadingLoad } = useQuery({
    queryKey: ['load', loadId],
    queryFn: () => api.loads.get(loadId),
    enabled: !loadParam && !!loadId
  });
  const load = loadParam ?? fetchedLoad;

  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: api.profile.me });
  const { data: trucks } = useQuery({ queryKey: ['trucks'], queryFn: api.trucks.mine });

  // Every hook above (and below) must run unconditionally on every render —
  // `load` starts out undefined for the deep-link entry point until its
  // fetch resolves, so the "not found yet" branch has to come after all
  // hooks are declared, not as an early return partway through them.
  const basePrice = Math.round((Number(load?.bhada_price) || 0) / BID_STEP) * BID_STEP;
  const [amount, setAmount] = useState(basePrice || BID_STEP);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [truckId, setTruckId] = useState(null);
  const selectedTruck = trucks?.find((tr) => tr.id === truckId) ?? null;

  // useState's initializer only runs once on mount — fine for LoadCard's
  // in-app navigation (load is already there on the first render), but the
  // deep-link entry point mounts with load still undefined (basePrice 0,
  // amount defaulting to BID_STEP) until its fetch resolves. This resyncs
  // amount once the real basePrice is known instead of leaving the stepper
  // stuck at ₹500 for a bid opened from WhatsApp.
  useEffect(() => {
    if (!loadParam && loadId) setAmount(basePrice || BID_STEP);
  }, [basePrice, loadParam, loadId]);

  const bidMutation = useMutation({
    mutationFn: () =>
      api.loadBids.place({
        load_id: load?.id,
        amount,
        bid_by_type: profile?.user_type,
        truck_id: selectedTruck?.id,
        truck_number: selectedTruck?.registration_number
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myBids'] });
      queryClient.invalidateQueries({ queryKey: ['loads'] });
      navigation.goBack();
    },
    onError: (err) => setError(err.message)
  });

  const adjust = (delta) => setAmount((a) => Math.max(BID_STEP, a + delta));

  if (!load) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 p-6">
        {isLoadingLoad ? (
          <ActivityIndicator size="large" color="#f97316" />
        ) : (
          <Text className="text-center text-sm text-slate-500">{t('loadNotFound')}</Text>
        )}
      </View>
    );
  }

  const truckTypeLabel =
    load.required_truck_type === 'other'
      ? load.required_truck_type_other || t('other')
      : TRUCK_TYPE_LABELS[language]?.[load.required_truck_type] ?? load.required_truck_type;

  const loadingWhen = loadingWhenLabel(load.loading_date, t);
  const unloadingWhen = unloadingDateLabel(load.unloading_date);

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

        <TruckChips trucks={trucks} selectedId={truckId} onSelect={setTruckId} t={t} />

        <ConfirmDetailsCheckbox checked={confirmed} onChange={setConfirmed} t={t} />

        <TouchableOpacity
          onPress={() => bidMutation.mutate()}
          disabled={bidMutation.isPending || amount <= 0 || !confirmed}
          className="items-center rounded-2xl bg-green-600 py-4"
          style={bidMutation.isPending || !confirmed ? { opacity: 0.6 } : undefined}
        >
          <Text className="text-base font-bold text-white">{t('confirmThisRate')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
