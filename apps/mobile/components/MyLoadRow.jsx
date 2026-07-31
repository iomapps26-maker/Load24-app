import { View, Text, TouchableOpacity } from 'react-native';
import { Icon } from 'react-native-paper';

export default function MyLoadRow({ load, t, navigation }) {
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
      <TouchableOpacity
        className="flex-row items-center gap-1 rounded-lg bg-brand px-3 py-2"
        onPress={() => navigation.navigate('SeeBidding', { loadId: load.id })}
      >
        <Icon source="gavel" size={14} color="white" />
        <Text className="text-xs font-bold text-white">{t('seeBidding')}</Text>
      </TouchableOpacity>
    </View>
  );
}
