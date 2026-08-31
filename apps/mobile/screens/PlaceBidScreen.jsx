import { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Icon } from 'react-native-paper';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { TRUCK_TYPE_LABELS } from '../lib/loadOptions';
import ConfirmDetailsCheckbox from '../components/ConfirmDetailsCheckbox';
import DateField from '../components/DateField';

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

// One line of the payment breakup: label on the left, ₹ amount on the right.
// `strong` bolds it (the "You receive" total), `muted` greys it (the Load24
// charge deduction).
function BreakupRow({ label, amount, sign = '', strong = false, muted = false }) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text className={`text-sm ${strong ? 'font-bold text-slate-900' : muted ? 'text-slate-500' : 'text-slate-600'}`}>{label}</Text>
      <Text className={`text-sm ${strong ? 'font-extrabold text-slate-900' : muted ? 'text-slate-500' : 'font-semibold text-slate-800'}`}>
        {sign}₹{Number(amount).toLocaleString('en-IN')}
      </Text>
    </View>
  );
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

// Mirrors the backend's lib/bidEligibility.js truck checks so the button can
// disable (and say why) before the server's coded 403 comes back. Only
// consulted for vehicle_owner / driver bidders — every other role bids with
// no vehicle at all.
function docExpired(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function isTruckEligibleForLoad(truck, load) {
  if (!truck || !load) return false;
  if (!truck.verified) return false;
  if (docExpired(truck.permit_expiry) || docExpired(truck.puc_expiry) || docExpired(truck.insurance_expiry)) return false;

  const required = load.required_truck_type;
  const typeOk =
    required === 'other' && truck.truck_type === 'other'
      ? !!(load.required_truck_type_other || '').trim() &&
        (load.required_truck_type_other || '').trim().toLowerCase() === (truck.truck_type_other || '').trim().toLowerCase()
      : required === truck.truck_type;
  if (!typeOk) return false;

  const capacity = truck.capacity_tons == null ? NaN : Number(truck.capacity_tons);
  const weight = Number(load.weight_tons);
  if (Number.isNaN(capacity)) return false;
  if (weight > 0 && capacity < weight) return false;
  return true;
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
  // Load24 charge % + wallet security-deposit amount for the payment breakup
  // below — both are staff-tunable from the admin panel, so they're fetched
  // rather than hardcoded. `['wallet']` is the same cache key WalletScreen
  // fills, so this is usually a warm read.
  const { data: biddingConfig } = useQuery({ queryKey: ['biddingConfig'], queryFn: api.loadBids.config });
  const { data: wallet, isLoading: isLoadingWallet } = useQuery({ queryKey: ['wallet'], queryFn: api.wallet.balance });

  // Every hook above (and below) must run unconditionally on every render —
  // `load` starts out undefined for the deep-link entry point until its
  // fetch resolves, so the "not found yet" branch has to come after all
  // hooks are declared, not as an early return partway through them.
  const basePrice = Math.round((Number(load?.bhada_price) || 0) / BID_STEP) * BID_STEP;
  const [amount, setAmount] = useState(basePrice || BID_STEP);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [truckId, setTruckId] = useState(null);
  // Optional: the date the bidder expects to pick the load up. Pre-filled
  // with the load's own loading date as the natural starting point — the
  // bidder can push it out or clear it. Sent as expected_pickup_at.
  const [expectedPickup, setExpectedPickup] = useState(load?.loading_date || '');
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

  // Same resync for the deep-link entry point: `load` (and its loading_date)
  // isn't known on the first render, so seed the expected-pickup default once
  // it resolves — unless the bidder has already picked a date themselves.
  useEffect(() => {
    if (!loadParam && loadId && load?.loading_date) {
      setExpectedPickup((current) => current || load.loading_date);
    }
  }, [load?.loading_date, loadParam, loadId]);

  const bidMutation = useMutation({
    mutationFn: () =>
      api.loadBids.place({
        load_id: load?.id,
        amount,
        bid_by_type: profile?.user_type,
        truck_id: selectedTruck?.id,
        truck_number: selectedTruck?.registration_number,
        expected_pickup_at: expectedPickup || undefined
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myBids'] });
      queryClient.invalidateQueries({ queryKey: ['loads'] });
      navigation.goBack();
    },
    onError: (err) => setError(err.message)
  });

  const adjust = (delta) => setAmount((a) => Math.max(BID_STEP, a + delta));

  // Payment breakup. chargePercent/securityDeposit fall back to the same
  // defaults the backend seeds (043_add_platform_settings.sql) so the card
  // still renders sensibly if the config fetch hasn't resolved. The wallet
  // check mirrors loadBids.js's POST / gate (available balance, not raw
  // balance) so the button disables for the same reason the server would 402.
  const chargePercent = Number(biddingConfig?.load24_charge_percent ?? 4);
  const securityDeposit = Number(biddingConfig?.security_deposit_amount ?? 1000);
  const load24Charge = Math.round((amount * chargePercent) / 100);
  const netReceive = amount - load24Charge;
  const walletBalance = Number(wallet?.available_balance ?? 0);
  // While the wallet balance is still loading (Render cold starts can take
  // 20s), don't block bidding on an unknown balance — the backend's POST /
  // gate is the real enforcement and its 402 message is surfaced via
  // `error`. Once it resolves, enforce the same rule the server does.
  const walletKnown = !isLoadingWallet;
  const meetsSecurityDeposit = securityDeposit <= 0 || !walletKnown || walletBalance >= securityDeposit;

  // Bidding is gated to KYC-verified users (loadBids.js POST / returns a
  // kyc_verification_required 403). Mirror it client-side: until the profile
  // resolves, don't block — the server stays the real enforcement.
  const kycKnown = profile !== undefined;
  const kycVerified = !kycKnown || profile?.kyc_status === 'verified';

  // Remaining bid-eligibility conditions (spec §2), all mirrored the same
  // "OK until the profile resolves" way — loadBids.js's coded 403 stays
  // authoritative and surfaces through `error`.
  const accountActive = profile?.is_active !== false;
  const mobileVerified = profile?.mobile_verified !== false;
  const notRestricted =
    !profile?.bidding_restricted_until || new Date(profile.bidding_restricted_until) <= new Date();
  // vehicle_owner / driver must bid with a truck that clears every vehicle
  // check; other roles never need one.
  const needsVehicle = ['vehicle_owner', 'driver'].includes(profile?.user_type);
  const vehicleEligible = !needsVehicle || isTruckEligibleForLoad(selectedTruck, load);
  const eligibleToBid = accountActive && mobileVerified && notRestricted && kycVerified && vehicleEligible;

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
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom:
            240 +
            (meetsSecurityDeposit ? 0 : 60) +
            (kycVerified ? 0 : 60) +
            (accountActive && mobileVerified && notRestricted && vehicleEligible ? 0 : 60)
        }}
      >
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

        <View className="mb-4 rounded-3xl border border-slate-100 bg-white p-5">
          <Text className="mb-3 text-base font-bold text-slate-900">{t('expectedPickupTitle')}</Text>
          <DateField label={t('expectedPickupDate')} value={expectedPickup} onChange={setExpectedPickup} />
        </View>

        <View className="mb-4 rounded-3xl border border-slate-100 bg-white p-5">
          <Text className="mb-2 text-base font-bold text-slate-900">{t('paymentBreakup')}</Text>

          <BreakupRow label={t('bidAmountLabel')} amount={amount} />
          <BreakupRow label={`${t('load24ChargeLabel')} (${chargePercent.toFixed(1)}%)`} amount={load24Charge} sign="− " muted />
          <View className="my-1 border-t border-slate-100" />
          <BreakupRow label={t('youReceiveLabel')} amount={netReceive} strong />

          {securityDeposit > 0 && (
            <View className="mt-3 rounded-2xl bg-slate-50 p-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-1.5">
                  <Icon source="shield-lock-outline" size={16} color="#475569" />
                  <Text className="text-sm font-semibold text-slate-700">{t('securityDepositLabel')}</Text>
                </View>
                <Text className="text-sm font-bold text-slate-900">₹{securityDeposit.toLocaleString('en-IN')}</Text>
              </View>
              <Text className="mt-1.5 text-xs leading-4 text-slate-500">{t('securityDepositHeldNote')}</Text>
              {walletKnown && (
                <View className="mt-2 flex-row items-center gap-1.5">
                  <Icon
                    source={walletBalance >= securityDeposit ? 'check-circle' : 'alert-circle-outline'}
                    size={14}
                    color={walletBalance >= securityDeposit ? '#16a34a' : '#dc2626'}
                  />
                  <Text className={`text-xs font-medium ${walletBalance >= securityDeposit ? 'text-green-700' : 'text-red-600'}`}>
                    {t('walletBalance')}: ₹{walletBalance.toLocaleString('en-IN')}
                  </Text>
                </View>
              )}
            </View>
          )}
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

        {!meetsSecurityDeposit && (
          <View className="mb-3 flex-row items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
            <Icon source="wallet-outline" size={16} color="#dc2626" />
            <Text className="flex-1 text-xs text-red-700">{t('securityDepositRequired')}</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Wallet')} className="rounded-full bg-red-600 px-3 py-1.5">
              <Text className="text-xs font-semibold text-white">{t('addMoney')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!kycVerified && (
          <View className="mb-3 flex-row items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2">
            <Icon source="shield-alert-outline" size={16} color="#f97316" />
            <Text className="flex-1 text-xs text-orange-800">{t('kycRequiredToBid')}</Text>
            <TouchableOpacity onPress={() => navigation.navigate('KycVerification')} className="rounded-full bg-orange-600 px-3 py-1.5">
              <Text className="text-xs font-semibold text-white">{t('kycVerification')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!accountActive && (
          <View className="mb-3 flex-row items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
            <Icon source="account-alert-outline" size={16} color="#dc2626" />
            <Text className="flex-1 text-xs text-red-700">{t('accountInactiveToBid')}</Text>
          </View>
        )}

        {accountActive && !mobileVerified && (
          <View className="mb-3 flex-row items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2">
            <Icon source="cellphone-check" size={16} color="#f97316" />
            <Text className="flex-1 text-xs text-orange-800">{t('mobileNotVerifiedToBid')}</Text>
            <TouchableOpacity onPress={() => navigation.navigate('ProfileSetup')} className="rounded-full bg-orange-600 px-3 py-1.5">
              <Text className="text-xs font-semibold text-white">{t('verifyMobileCta')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {accountActive && !notRestricted && (
          <View className="mb-3 flex-row items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
            <Icon source="cancel" size={16} color="#dc2626" />
            <Text className="flex-1 text-xs text-red-700">
              {profile?.bidding_restriction_reason
                ? `${t('biddingRestrictedToBid')} (${profile.bidding_restriction_reason})`
                : t('biddingRestrictedToBid')}
            </Text>
          </View>
        )}

        {accountActive && needsVehicle && !vehicleEligible && (
          <View className="mb-3 flex-row items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2">
            <Icon source="truck-alert-outline" size={16} color="#f97316" />
            <Text className="flex-1 text-xs text-orange-800">
              {selectedTruck ? t('vehicleNotEligibleToBid') : t('selectVehicleToBid')}
            </Text>
          </View>
        )}

        <TruckChips trucks={trucks} selectedId={truckId} onSelect={setTruckId} t={t} />

        <ConfirmDetailsCheckbox checked={confirmed} onChange={setConfirmed} t={t} />

        <TouchableOpacity
          onPress={() => bidMutation.mutate()}
          disabled={bidMutation.isPending || amount <= 0 || !confirmed || !meetsSecurityDeposit || !eligibleToBid}
          className="items-center rounded-2xl bg-green-600 py-4"
          style={bidMutation.isPending || !confirmed || !meetsSecurityDeposit || !eligibleToBid ? { opacity: 0.6 } : undefined}
        >
          <Text className="text-base font-bold text-white">{t('confirmThisRate')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
