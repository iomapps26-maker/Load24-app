import { View, Text, Pressable } from 'react-native';
import { Card, IconButton } from 'react-native-paper';

export default function LoadCard({ load, liked, onToggleLike }) {
  return (
    <Card className="mb-3" mode="outlined">
      <Card.Content>
        <View className="flex-row items-center justify-between">
          <Text className="text-base font-semibold text-slate-900">
            {load.loading_city || load.loading_pincode} → {load.unloading_city || load.unloading_pincode}
          </Text>
          <IconButton
            icon={liked ? 'heart' : 'heart-outline'}
            iconColor={liked ? '#dc2626' : '#64748b'}
            onPress={() => onToggleLike(load)}
          />
        </View>
        <Text className="mt-1 text-sm text-slate-500">
          {load.material_type} • {load.weight_tons}T • {load.required_truck_type}
        </Text>
        <Text className="mt-2 text-lg font-bold text-brand">
          ₹{Number(load.bhada_price).toLocaleString('en-IN')}
        </Text>
      </Card.Content>
    </Card>
  );
}
