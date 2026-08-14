import { View, Text, TouchableOpacity } from 'react-native';
import { openUpiApp } from '../lib/upi';

// PhonePe/GPay/Paytm/BHIM shortcuts for a given payee — reused for both
// LOAD24's own UPI account and Vivek Gupta's, each deep-linking with its
// own `payee` so the right person gets paid regardless of which card the
// buttons were tapped from.
export default function UpiAppButtons({ payee, t }) {
  return (
    <View className="mt-4 flex-row flex-wrap gap-2">
      <TouchableOpacity className="rounded-full bg-purple-600 px-4 py-2" onPress={() => openUpiApp('phonepe', t, payee)}>
        <Text className="text-xs font-bold text-white">PhonePe</Text>
      </TouchableOpacity>
      <TouchableOpacity className="rounded-full border border-slate-300 px-4 py-2" onPress={() => openUpiApp('gpay', t, payee)}>
        <Text className="text-xs font-bold text-slate-700">GPay</Text>
      </TouchableOpacity>
      <TouchableOpacity className="rounded-full bg-blue-600 px-4 py-2" onPress={() => openUpiApp('paytm', t, payee)}>
        <Text className="text-xs font-bold text-white">Paytm</Text>
      </TouchableOpacity>
      <TouchableOpacity className="rounded-full bg-brand px-4 py-2" onPress={() => openUpiApp('bhim', t, payee)}>
        <Text className="text-xs font-bold text-white">BHIM/UPI</Text>
      </TouchableOpacity>
    </View>
  );
}
