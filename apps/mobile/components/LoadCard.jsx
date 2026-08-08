import { View, Text, TouchableOpacity } from 'react-native';
import { Icon } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useLanguage } from '../lib/i18n';
import { TRUCK_TYPE_LABELS, FUEL_LABELS } from '../lib/loadOptions';

function formatDate(dateStr, language) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(language === 'hi' ? 'hi-IN' : 'en-IN', { day: '2-digit', month: 'short' });
}

export default function LoadCard({ load, liked, onToggleLike, bidStatus, hideActions }) {
  const { language, t } = useLanguage();
  const navigation = useNavigation();

  const truckTypeLabel =
    load.required_truck_type === 'other'
      ? load.required_truck_type_other || t('other')
      : TRUCK_TYPE_LABELS[language]?.[load.required_truck_type] ?? load.required_truck_type;
  const fuelLabel =
    load.fuel_type_required === 'other'
      ? load.fuel_type_required_other || t('other')
      : FUEL_LABELS[language]?.[load.fuel_type_required] ?? t('any');

  return (
    <View className="mb-4 overflow-hidden rounded-3xl border-l-4 border-brand bg-white shadow-md">
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
          <View className="items-center">
            <Icon source="arrow-right" size={20} color="#f97316" />
            {/* distance_km is computed once server-side at posting time
                (googleMaps.js) and stored on the load — reused here as-is,
                never recalculated on the client. */}
            {!!load.distance_km && <Text className="mt-0.5 text-[10px] text-slate-400">{load.distance_km} km</Text>}
          </View>
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
            <Icon source="package-variant-closed" size={18} color="#64748b" />
            <View>
              <Text className="text-xs text-slate-400">{t('material')}</Text>
              <Text className="text-sm font-semibold text-slate-800">{load.material_type}</Text>
            </View>
          </View>
          <View className="flex-1 flex-row items-center gap-2">
            <Icon source="weight-kilogram" size={18} color="#64748b" />
            <View>
              <Text className="text-xs text-slate-400">{t('weight')}</Text>
              <Text className="text-sm font-semibold text-slate-800">{load.weight_tons} {t('tons')}</Text>
            </View>
          </View>
        </View>

        <View className="mt-3 flex-row justify-between">
          <View className="flex-1 flex-row items-center gap-2">
            <Icon source="truck-outline" size={18} color="#64748b" />
            <View>
              <Text className="text-xs text-slate-400">{t('truckType')}</Text>
              <Text className="text-sm font-semibold text-slate-800">{truckTypeLabel}</Text>
            </View>
          </View>
          <View className="flex-1 flex-row items-center gap-2">
            <Icon source="gas-station-outline" size={18} color="#64748b" />
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
            <Text className="text-2xl font-extrabold text-green-600">
              ₹{Number(load.bhada_price).toLocaleString('en-IN')}
            </Text>
            <View className="mt-1 flex-row items-center gap-1">
              <Icon source="calendar" size={12} color="#94a3b8" />
              <Text className="text-xs text-slate-400">{formatDate(load.loading_date, language)}</Text>
            </View>
          </View>

          {!hideActions && (
            <TouchableOpacity
              onPress={() => onToggleLike(load)}
              className={`flex-row items-center gap-1.5 rounded-xl px-6 py-3.5 ${liked ? 'bg-red-600' : 'bg-brand'}`}
            >
              <Icon source={liked ? 'heart' : 'heart-outline'} size={18} color="#ffffff" />
              <Text className="text-base font-bold text-white">{liked ? t('liked') : t('like')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {!hideActions && (
          bidStatus ? (
            <View
              className={`mt-3 items-center rounded-xl py-2.5 ${
                bidStatus === 'approved' ? 'bg-green-100' : bidStatus === 'rejected' ? 'bg-red-100' : 'bg-orange-100'
              }`}
            >
              <Text
                className={`text-sm font-bold ${
                  bidStatus === 'approved' ? 'text-green-700' : bidStatus === 'rejected' ? 'text-red-700' : 'text-orange-700'
                }`}
              >
                {bidStatus === 'approved' ? t('bidApproved') : bidStatus === 'rejected' ? t('bidRejected') : t('bidPending')}
              </Text>
            </View>
          ) : null
        )}

        {!hideActions && bidStatus === 'approved' && (
          <TouchableOpacity
            onPress={() => navigation.navigate('TripDetails', { loadId: load.id })}
            className="mt-3 flex-row items-center justify-center gap-1.5 rounded-xl bg-brand py-3"
          >
            <Icon source="file-document-outline" size={18} color="#ffffff" />
            <Text className="text-base font-bold text-white">{t('viewTripDetails')}</Text>
          </TouchableOpacity>
        )}

        {!hideActions && !bidStatus && (
          <TouchableOpacity
            onPress={() => navigation.navigate('PlaceBid', { load })}
            className="mt-3 flex-row items-center justify-center gap-1.5 rounded-xl border-2 border-brand py-3"
          >
            <Icon source="gavel" size={18} color="#f97316" />
            <Text className="text-base font-bold text-brand">{t('letsBidding')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
