import { View, Text, TouchableOpacity } from 'react-native';
import { Icon } from 'react-native-paper';

export default function MyLoadRow({ load, t, navigation }) {
  // Once a load is matched, bidding is over — send the poster straight to
  // the trip (contact info + KYC docs of the accepted bidder) instead of
  // back through the bid-review list they no longer need.
  const isMatched = load.status === 'matched';

  return (
    <View className="mb-3 flex-row items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
      <View className="flex-1 pr-2">
        <Text className="text-sm font-bold text-slate-900" numberOfLines={1}>
          {load.loading_city || load.loading_pincode} → {load.unloading_city || load.unloading_pincode}
        </Text>
        <Text className="mt-1 text-xs text-slate-500">
          {load.material_type} • ₹{Number(load.bhada_price).toLocaleString('en-IN')}
        </Text>
      </View>
      {isMatched ? (
        <TouchableOpacity
          className="flex-row items-center gap-1 rounded-lg bg-brand px-3 py-2"
          onPress={() => navigation.navigate('TripDetails', { loadId: load.id })}
        >
          <Icon source="file-document-outline" size={14} color="white" />
          <Text className="text-xs font-bold text-white">{t('viewTripDetails')}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          className="flex-row items-center gap-1 rounded-lg bg-brand px-3 py-2"
          onPress={() => navigation.navigate('SeeBidding', { loadId: load.id })}
        >
          <Icon source="gavel" size={14} color="white" />
          <Text className="text-xs font-bold text-white">{t('seeBidding')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
