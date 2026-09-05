import { View, Text, TouchableOpacity } from 'react-native';
import { Icon } from 'react-native-paper';

// Same status pill styling SeeBiddingScreen uses for a bid row (poster's
// view of one bid) — kept in sync by hand since this is the accepter's
// equivalent view of their own bid.
const STATUS_BADGE = {
  approved: { bg: 'bg-green-100', text: 'text-green-700', key: 'bidApproved' },
  rejected: { bg: 'bg-red-100', text: 'text-red-700', key: 'bidRejected' },
  pending: { bg: 'bg-orange-100', text: 'text-orange-700', key: 'bidPending' }
};

// One row of TripHistoryScreen — a bid the caller placed as the accepter,
// whatever it ended up as. Mirrors MyLoadRow's card for the poster side, but
// the load only comes along embedded on the bid (see GET /api/load-bids/mine)
// and only an approved bid has a trip to view — a pending or rejected one
// never got a booking.
export default function MyBidRow({ bid, t, navigation }) {
  const load = bid.load;
  const badge = STATUS_BADGE[bid.status] ?? STATUS_BADGE.pending;

  return (
    <View className="mb-3 rounded-2xl border border-slate-200 bg-white p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-2">
          <Text className="text-sm font-bold text-slate-900" numberOfLines={1}>
            {load.loading_city || load.loading_pincode} → {load.unloading_city || load.unloading_pincode}
          </Text>
          <Text className="mt-1 text-xs text-slate-500">
            {load.material_type} • ₹{Number(bid.amount).toLocaleString('en-IN')}
            {!!load.distance_km && ` • ${load.distance_km} km`}
          </Text>
          {!!bid.booking?.booking_ref && (
            <Text className="mt-0.5 text-xs font-semibold text-slate-600">
              {t('bookingId')}: {bid.booking.booking_ref}
            </Text>
          )}
        </View>
        <View className={`rounded-full px-3 py-1 ${badge.bg}`}>
          <Text className={`text-xs font-semibold ${badge.text}`}>{t(badge.key)}</Text>
        </View>
      </View>

      {bid.status === 'approved' && (
        <TouchableOpacity
          className="mt-3 flex-row items-center justify-center gap-1 self-start rounded-lg bg-brand px-3 py-2"
          onPress={() => navigation.navigate('TripDetails', { loadId: load.id })}
        >
          <Icon source="file-document-outline" size={14} color="white" />
          <Text className="text-xs font-bold text-white">{t('viewTripDetails')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
