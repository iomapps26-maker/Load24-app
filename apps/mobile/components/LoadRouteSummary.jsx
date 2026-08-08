import { View, Text } from 'react-native';
import { Icon } from 'react-native-paper';
import { useLanguage } from '../lib/i18n';
import { TRUCK_TYPE_LABELS } from '../lib/loadOptions';

// "Today"/"Tomorrow" reads much faster on a bidding card than a bare date —
// falls back to a short date once it's more than a day out.
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

// Compact route/truck/loading-time summary used as the load header on
// SeeBiddingScreen, where a poster is reviewing bids already placed — the
// full-detail equivalent for placing a bid lives in PlaceBidScreen.
export default function LoadRouteSummary({ load }) {
  const { language, t } = useLanguage();
  if (!load) return null;

  const truckTypeLabel =
    load.required_truck_type === 'other'
      ? load.required_truck_type_other || t('other')
      : TRUCK_TYPE_LABELS[language]?.[load.required_truck_type] ?? load.required_truck_type;

  const detailParts = [
    truckTypeLabel,
    load.truck_length_ft ? `${load.truck_length_ft} Ft` : null,
    load.weight_tons ? `${t('goods')} ${Number(load.weight_tons).toFixed(1)} ${t('ton')}` : null
  ].filter(Boolean);

  const when = loadingWhenLabel(load.loading_date, t);

  return (
    <View>
      <View className="flex-row">
        <View className="mr-3 items-center" style={{ width: 10, paddingTop: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#16a34a' }} />
          <View style={{ flex: 1, minHeight: 26, borderLeftWidth: 1.5, borderLeftColor: '#cbd5e1', borderStyle: 'dashed', marginVertical: 4 }} />
          <View style={{ width: 10, height: 10, backgroundColor: '#dc2626' }} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-bold text-slate-900" numberOfLines={1}>
            {load.loading_city || load.loading_pincode}
          </Text>
          <Text className="mb-4 text-xs text-slate-400">
            {[load.loading_pincode, load.loading_state].filter(Boolean).join(' · ')}
          </Text>
          <Text className="text-base font-bold text-slate-900" numberOfLines={1}>
            {load.unloading_city || load.unloading_pincode}
          </Text>
          <Text className="text-xs text-slate-400">
            {[load.unloading_pincode, load.unloading_state].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>

      <View className="my-3 h-px bg-slate-100" />

      {/* distance_km is computed once server-side at posting time
          (googleMaps.js) and stored on the load — reused here as-is, never
          recalculated on the client. */}
      {!!load.distance_km && (
        <View className="mb-2 flex-row items-center gap-2">
          <Icon source="map-marker-distance" size={18} color="#f59e0b" />
          <Text className="text-sm font-semibold text-slate-700">{t('tripDistance')} {load.distance_km} km</Text>
        </View>
      )}
      {!!detailParts.length && (
        <View className="mb-2 flex-row items-center gap-2">
          <Icon source="truck-outline" size={18} color="#f59e0b" />
          <Text className="flex-1 text-sm font-semibold text-slate-700">{detailParts.join(' | ')}</Text>
        </View>
      )}
      {!!when && !!load.loading_time && (
        <View className="flex-row items-center gap-2">
          <Icon source="clock-outline" size={18} color="#f59e0b" />
          <Text className="text-sm font-semibold text-slate-700">
            {t('loading')} {when} {t('at')} {load.loading_time}
          </Text>
        </View>
      )}
    </View>
  );
}
