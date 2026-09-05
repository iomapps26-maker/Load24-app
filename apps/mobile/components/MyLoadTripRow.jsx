import { View, Text, TouchableOpacity } from 'react-native';
import { Icon } from 'react-native-paper';
import { BOOKING_STATUS_BADGE } from '../lib/tripStatus';

// The poster-side counterpart to MyBidRow — one row of TripHistoryScreen for
// a load *this* account posted that actually became a trip. Only ever
// rendered for a load carrying a `booking` (matched/in_transit/completed/
// cancelled — see routes/loads.js's ?mine=true, which attaches one only for
// those statuses): a still-open posting with nobody's bid accepted yet isn't
// a trip, and stays out of Trip History entirely — that's what Your Posted
// Loads is for.
export default function MyLoadTripRow({ load, t, navigation }) {
  const badge = BOOKING_STATUS_BADGE[load.booking?.status] ?? BOOKING_STATUS_BADGE.confirmed;

  return (
    <View className="mb-3 rounded-2xl border border-slate-200 bg-white p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-2">
          <Text className="text-sm font-bold text-slate-900" numberOfLines={1}>
            {load.loading_city || load.loading_pincode} → {load.unloading_city || load.unloading_pincode}
          </Text>
          <Text className="mt-1 text-xs text-slate-500">
            {load.material_type} • ₹{Number(load.booking?.amount ?? load.bhada_price).toLocaleString('en-IN')}
            {!!load.distance_km && ` • ${load.distance_km} km`}
          </Text>
          {!!load.booking?.accepter_email && (
            <Text className="mt-0.5 text-xs text-slate-500" numberOfLines={1}>
              {t('acceptedBy')}: {load.booking.accepter_email}
            </Text>
          )}
          {!!load.booking?.booking_ref && (
            <Text className="mt-0.5 text-xs font-semibold text-slate-600">
              {t('bookingId')}: {load.booking.booking_ref}
            </Text>
          )}
        </View>
        <View className={`rounded-full px-3 py-1 ${badge.bg}`}>
          <Text className={`text-xs font-semibold ${badge.text}`}>{t(badge.key)}</Text>
        </View>
      </View>

      <TouchableOpacity
        className="mt-3 flex-row items-center justify-center gap-1 self-start rounded-lg bg-brand px-3 py-2"
        onPress={() => navigation.navigate('TripDetails', { loadId: load.id })}
      >
        <Icon source="file-document-outline" size={14} color="white" />
        <Text className="text-xs font-bold text-white">{t('viewTripDetails')}</Text>
      </TouchableOpacity>
    </View>
  );
}
