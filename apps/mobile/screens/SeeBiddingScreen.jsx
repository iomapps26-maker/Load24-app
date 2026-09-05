import { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { Icon } from 'react-native-paper';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import LoadRouteSummary from '../components/LoadRouteSummary';

function msRemaining(bid) {
  return new Date(bid.expires_at).getTime() - Date.now();
}

function pickupLabel(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

// The bidder stays anonymous to the poster until a bid is approved — no email
// (the WhatsApp-login ones are the bidder's phone number in disguise) and no
// vehicle registration. Their role is all the poster sees while deciding;
// TripDetails does the full contact reveal once a bid is confirmed.
const BID_TYPE_KEY = {
  vehicle_owner: 'roleVehicleOwner',
  transporter: 'roleTransporter',
  broker: 'roleBroker',
  driver: 'roleDriver',
  shipper: 'roleShipper'
};

function BidRow({ bid, onApprove, onReject, approving, rejecting }) {
  const { t } = useLanguage();
  const [remainingMs, setRemainingMs] = useState(() => msRemaining(bid));

  useEffect(() => {
    if (bid.status !== 'pending') return undefined;
    const interval = setInterval(() => setRemainingMs(msRemaining(bid)), 1000);
    return () => clearInterval(interval);
  }, [bid]);

  const stillOpen = bid.status === 'pending' && remainingMs > 0;
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  // The confirmation window is minutes, not seconds (migration 054) — show
  // M:SS, not the old 0:SS that assumed under a minute.
  const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  const statusStyle = {
    approved: { bg: 'bg-green-100', text: 'text-green-700', label: t('bidApproved') },
    rejected: { bg: 'bg-red-100', text: 'text-red-700', label: t('bidRejected') },
    pending: { bg: 'bg-orange-100', text: 'text-orange-700', label: stillOpen ? `${t('bidPending')} · ${countdown}` : t('bidRejected') }
  }[bid.status] ?? { bg: 'bg-slate-100', text: 'text-slate-700', label: bid.status };

  return (
    <View className="mb-3 rounded-2xl border border-slate-200 bg-white p-4">
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-xl font-extrabold text-slate-900">₹{Number(bid.amount).toLocaleString('en-IN')}</Text>
          <Text className="text-xs text-slate-400">
            {BID_TYPE_KEY[bid.bid_by_type] ? t(BID_TYPE_KEY[bid.bid_by_type]) : t('bidderGeneric')}
            {bid.status === 'approved' && bid.truck_number ? ` · ${bid.truck_number}` : ''}
          </Text>
          {!!pickupLabel(bid.expected_pickup_at) && (
            <Text className="mt-0.5 text-xs text-slate-500">{t('expectedPickupShort')}: {pickupLabel(bid.expected_pickup_at)}</Text>
          )}
        </View>
        <View className={`rounded-full px-3 py-1 ${statusStyle.bg}`}>
          <Text className={`text-xs font-bold ${statusStyle.text}`}>{statusStyle.label}</Text>
        </View>
      </View>

      {stillOpen && (
        <View className="mt-3 flex-row gap-2">
          <TouchableOpacity
            onPress={() => onReject(bid.id)}
            disabled={approving || rejecting}
            className="flex-1 items-center rounded-xl border-2 border-red-500 py-2.5"
            style={approving || rejecting ? { opacity: 0.5 } : undefined}
          >
            <Text className="text-sm font-bold text-red-600">{rejecting ? t('rejecting') : t('reject')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onApprove(bid.id)}
            disabled={approving || rejecting}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-green-600 py-2.5"
            style={approving || rejecting ? { opacity: 0.5 } : undefined}
          >
            {approving && <ActivityIndicator size="small" color="#ffffff" />}
            <Text className="text-sm font-bold text-white">{approving ? t('approving') : t('approve')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// Poster-only screen: shows one load exactly as it appears on the load feed,
// plus every bid placed against it. Bids auto-reject 5 minutes after being
// placed if the poster hasn't approved/rejected (migration 057) —
// GET /api/load-bids/load/:id flips any expired pending bid on the server
// (rate-limited to one sweep per load per 30s), so a 10s refetchInterval here
// keeps the list fresh without hammering that endpoint. The per-bid countdown
// in BidRow ticks every second locally regardless.
export default function SeeBiddingScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { loadId } = route.params;
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['loadBids', loadId],
    queryFn: () => api.loadBids.forLoad(loadId),
    refetchInterval: 10000
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['loadBids', loadId] });
  const approveMutation = useMutation({
    mutationFn: (id) => api.loadBids.approve(id),
    onSuccess: invalidate,
    // Every failure gets an alert, not just 409 — a silent refetch after a
    // timed-out request (Render cold start) or a 4xx/5xx just looked like the
    // Approve button did nothing. `load_already_booked` is the racing-
    // confirmation case with its own copy; everything else (bidder no longer
    // eligible, security hold gone, the window lapsed mid-tap, the server
    // waking up) shows the server's own message verbatim.
    onError: (err) => {
      invalidate();
      if (err?.code === 'load_already_booked') {
        Alert.alert(t('loadAlreadyBookedTitle'), t('loadAlreadyBooked'));
      } else {
        Alert.alert(t('couldNotConfirmTitle'), err?.message || t('couldNotConfirmTitle'));
      }
    }
  });
  const rejectMutation = useMutation({
    mutationFn: (id) => api.loadBids.reject(id),
    onSuccess: invalidate,
    onError: (err) => {
      invalidate();
      Alert.alert(t('couldNotRejectTitle'), err?.message || t('couldNotRejectTitle'));
    }
  });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator color="#f97316" />
      </View>
    );
  }

  const { load, bids = [], booking } = data || {};
  const hasApprovedBid = bids.some((bid) => bid.status === 'approved');

  return (
    <ScrollView className="flex-1 bg-slate-50 px-4 pt-4">
      {!!load && (
        <View className="mb-4 rounded-3xl border border-slate-200 bg-white p-5">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-xs text-slate-400">{load.material_type}</Text>
            <Text className="text-lg font-extrabold text-green-600">
              ₹{Number(load.bhada_price).toLocaleString('en-IN')}
            </Text>
          </View>
          <LoadRouteSummary load={load} />
        </View>
      )}

      {!!booking?.booking_ref && (
        <View className="mb-4 flex-row items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-3">
          <Icon source="identifier" size={16} color="#64748b" />
          <Text className="text-xs text-slate-400">{t('bookingId')}</Text>
          <Text className="text-sm font-bold text-slate-900">{booking.booking_ref}</Text>
        </View>
      )}

      {hasApprovedBid && (
        <TouchableOpacity
          onPress={() => navigation.navigate('TripDetails', { loadId })}
          className="mb-4 flex-row items-center justify-center gap-2 rounded-xl bg-brand py-3.5"
        >
          <Icon source="file-document-outline" size={18} color="#ffffff" />
          <Text className="text-base font-bold text-white">{t('viewTripDetails')}</Text>
        </TouchableOpacity>
      )}

      <Text className="mb-3 text-lg font-bold text-slate-900">{t('allBids')}</Text>
      {bids.length === 0 ? (
        <Text className="mt-4 text-center text-slate-400">{t('noBidsYet')}</Text>
      ) : (
        bids.map((bid) => (
          <BidRow
            key={bid.id}
            bid={bid}
            onApprove={(id) => approveMutation.mutate(id)}
            onReject={(id) => rejectMutation.mutate(id)}
            approving={approveMutation.isPending}
            rejecting={rejectMutation.isPending}
          />
        ))
      )}
    </ScrollView>
  );
}
