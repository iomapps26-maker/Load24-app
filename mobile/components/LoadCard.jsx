import { View, Text, TouchableOpacity } from 'react-native';
import { Icon } from 'react-native-paper';
import { useLanguage } from '../lib/i18n';

const TRUCK_TYPE_LABELS = {
  en: {
    mahindra_pickup: 'Mahindra Pickup', tata_407: 'Tata 407', tata_ace: 'Tata Ace',
    chota_hathi: 'Chota Hathi', four_vehicle_loader: '4-Wheeler Loader', eicher_truck: 'Eicher Truck',
    ashok_leyland: 'Ashok Leyland', lcv: 'LCV', lgv: 'LGV', open_body: 'Open Body',
    closed_body: 'Closed Body', container: 'Container', trailer: 'Trailer', tanker: 'Tanker',
    tipper: 'Tipper', flatbed: 'Flatbed', car_carrier: 'Car Carrier'
  },
  hi: {
    mahindra_pickup: 'महिंद्रा पिकअप', tata_407: 'टाटा 407', tata_ace: 'टाटा ऐस',
    chota_hathi: 'छोटा हाथी', four_vehicle_loader: '4-व्हीलर लोडर', eicher_truck: 'आयशर ट्रक',
    ashok_leyland: 'अशोक लेलैंड', lcv: 'LCV', lgv: 'LGV', open_body: 'खुला बॉडी',
    closed_body: 'बंद बॉडी', container: 'कंटेनर', trailer: 'ट्रेलर', tanker: 'टैंकर',
    tipper: 'टिपर', flatbed: 'फ्लैटबेड', car_carrier: 'कार कैरियर'
  }
};

const FUEL_LABELS = {
  en: { diesel: 'Diesel', cng: 'CNG', electric: 'Electric', any: 'Any' },
  hi: { diesel: 'डीजल', cng: 'सीएनजी', electric: 'इलेक्ट्रिक', any: 'कोई भी' }
};

function formatDate(dateStr, language) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(language === 'hi' ? 'hi-IN' : 'en-IN', { day: '2-digit', month: 'short' });
}

export default function LoadCard({ load, liked, onToggleLike }) {
  const { language, t } = useLanguage();

  const truckTypeLabel = TRUCK_TYPE_LABELS[language]?.[load.required_truck_type] ?? load.required_truck_type;
  const fuelLabel = FUEL_LABELS[language]?.[load.fuel_type_required] ?? t('any');

  return (
    <View className="mb-4 overflow-hidden rounded-2xl border-l-4 border-brand bg-white shadow-sm">
      {/* Route */}
      <View className="bg-orange-50 px-4 py-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <View className="flex-row items-center gap-1">
              <Icon source="map-marker" size={14} color="#16a34a" />
              <Text className="text-xs text-slate-500">{t('from')}</Text>
            </View>
            <Text className="text-base font-bold text-slate-900" numberOfLines={1}>
              {load.loading_city || load.loading_pincode}
            </Text>
            {!!load.loading_landmark && (
              <Text className="text-xs text-slate-400" numberOfLines={1}>{load.loading_landmark}</Text>
            )}
          </View>
          <Icon source="arrow-right" size={20} color="#f97316" />
          <View className="flex-1 items-end">
            <View className="flex-row items-center gap-1">
              <Text className="text-xs text-slate-500">{t('to')}</Text>
              <Icon source="map-marker" size={14} color="#dc2626" />
            </View>
            <Text className="text-base font-bold text-slate-900" numberOfLines={1}>
              {load.unloading_city || load.unloading_pincode}
            </Text>
            {!!load.unloading_landmark && (
              <Text className="text-xs text-slate-400" numberOfLines={1}>{load.unloading_landmark}</Text>
            )}
          </View>
        </View>
      </View>

      {/* Details */}
      <View className="px-4 py-3">
        <View className="flex-row justify-between">
          <View className="flex-1 flex-row items-center gap-2">
            <Icon source="package-variant-closed" size={16} color="#64748b" />
            <View>
              <Text className="text-xs text-slate-400">{t('material')}</Text>
              <Text className="text-sm font-semibold text-slate-800">{load.material_type}</Text>
            </View>
          </View>
          <View className="flex-1 flex-row items-center gap-2">
            <Icon source="weight-kilogram" size={16} color="#64748b" />
            <View>
              <Text className="text-xs text-slate-400">{t('weight')}</Text>
              <Text className="text-sm font-semibold text-slate-800">{load.weight_tons} {t('tons')}</Text>
            </View>
          </View>
        </View>

        <View className="mt-3 flex-row justify-between">
          <View className="flex-1 flex-row items-center gap-2">
            <Icon source="truck-outline" size={16} color="#64748b" />
            <View>
              <Text className="text-xs text-slate-400">{t('truckType')}</Text>
              <Text className="text-sm font-semibold text-slate-800">{truckTypeLabel}</Text>
            </View>
          </View>
          <View className="flex-1 flex-row items-center gap-2">
            <Icon source="gas-station-outline" size={16} color="#64748b" />
            <View>
              <Text className="text-xs text-slate-400">{t('fuel')}</Text>
              <Text className="text-sm font-semibold text-slate-800">{fuelLabel}</Text>
            </View>
          </View>
        </View>

        <View className="my-3 h-px bg-slate-100" />

        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-xs text-slate-400">{t('price')}</Text>
            <Text className="text-xl font-extrabold text-green-600">
              ₹{Number(load.bhada_price).toLocaleString('en-IN')}
            </Text>
            <View className="mt-1 flex-row items-center gap-1">
              <Icon source="calendar" size={12} color="#94a3b8" />
              <Text className="text-xs text-slate-400">{formatDate(load.loading_date, language)}</Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => onToggleLike(load)}
            className={`flex-row items-center gap-1.5 rounded-xl px-5 py-3 ${liked ? 'bg-red-600' : 'bg-brand'}`}
          >
            <Icon source={liked ? 'heart' : 'heart-outline'} size={18} color="#ffffff" />
            <Text className="text-sm font-bold text-white">{liked ? t('liked') : t('like')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
