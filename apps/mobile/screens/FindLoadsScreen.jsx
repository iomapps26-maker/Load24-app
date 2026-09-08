import { useState } from 'react';
import { View, Text, FlatList, Pressable, TouchableOpacity, RefreshControl, ScrollView } from 'react-native';
import { ActivityIndicator, Icon } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import LoadCard from '../components/LoadCard';
import LocationPickerModal from '../components/LocationPickerModal';

// Only truck-owning accounts get the vehicle picker (matches MainTabs'
// TRUCK_OWNER_TYPES / the backend's TRUCK_ROLES).
const TRUCK_OWNER_TYPES = ['driver', 'vehicle_owner'];

// A load "matches" one of the account's vehicles when that vehicle could
// actually carry it: the load's required truck type is exactly this vehicle's
// type (same 'other' free-text rule as PlaceBidScreen's truckIneligibility)
// and the vehicle's payload capacity covers the load's weight. Vehicle
// readiness checks (verification, document expiry) are left out on purpose —
// those gate *bidding*, not whether a load is worth showing, and
// PlaceBidScreen still enforces them at bid time.
function loadMatchesVehicle(vehicle, load) {
  if (!vehicle || !load) return false;

  const required = load.required_truck_type;
  const typeOk =
    required === 'other' && vehicle.truck_type === 'other'
      ? !!(load.required_truck_type_other || '').trim() &&
        (load.required_truck_type_other || '').trim().toLowerCase() ===
          (vehicle.truck_type_other || '').trim().toLowerCase()
      : required === vehicle.truck_type;
  if (!typeOk) return false;

  const capacity = vehicle.capacity_tons == null ? NaN : Number(vehicle.capacity_tons);
  const weight = Number(load.weight_tons);
  if (Number.isNaN(capacity)) return false;
  if (weight > 0 && capacity < weight) return false;
  return true;
}

// Mobile port of src/pages/FindLoads.jsx. The pickup and drop points are
// filtered separately — each field opens the same city/pincode picker, and
// the backend ANDs the two (see routes/loads.js) so a search reads as a
// route: "loads FROM here TO there".
export default function FindLoadsScreen() {
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  // One city or pincode per side; null means "any" for that side.
  const [loadingLocation, setLoadingLocation] = useState(null);
  const [unloadingLocation, setUnloadingLocation] = useState(null);
  // Which field the full-screen picker is editing: 'loading' | 'unloading' | null.
  const [pickerTarget, setPickerTarget] = useState(null);
  // The vehicle whose loads the truck owner wants to see; null means "all
  // loads" (the picker is hidden entirely for non–truck-owner accounts).
  const [selectedTruckId, setSelectedTruckId] = useState(null);

  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: api.profile.me });

  // Same ['trucks'] cache key PlaceBidScreen / TruckDetailsScreen fill, so
  // this is usually a warm read with no extra request.
  const { data: trucks = [] } = useQuery({
    queryKey: ['trucks'],
    queryFn: api.trucks.mine,
    enabled: TRUCK_OWNER_TYPES.includes(profile?.user_type)
  });

  const showVehiclePicker = TRUCK_OWNER_TYPES.includes(profile?.user_type) && trucks.length > 0;
  const selectedTruck = showVehiclePicker
    ? trucks.find((tr) => tr.id === selectedTruckId) ?? null
    : null;

  const {
    data: loads = [],
    isLoading,
    isRefetching,
    refetch
  } = useQuery({
    queryKey: ['loads', loadingLocation, unloadingLocation],
    queryFn: () => api.loads.list({
      loading_location: loadingLocation || undefined,
      unloading_location: unloadingLocation || undefined
    })
  });

  // Location filtering already happened server-side; the vehicle filter just
  // compounds on top — pick a vehicle with no route set and you get every
  // load it can carry, pick a vehicle *and* a route and you get only the
  // loads on that route it can carry.
  const visibleLoads = selectedTruck
    ? loads.filter((load) => loadMatchesVehicle(selectedTruck, load))
    : loads;

  const { data: myLikes = [] } = useQuery({
    queryKey: ['myLikes'],
    queryFn: api.loadLikes.mine
  });

  const likeMutation = useMutation({
    mutationFn: ({ load, existingLike }) =>
      existingLike ? api.loadLikes.unlike(existingLike.id) : api.loadLikes.like({
        load_id: load.id,
        liked_by_type: profile?.user_type
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myLikes'] });
      queryClient.invalidateQueries({ queryKey: ['loads'] });
    }
  });

  const toggleLike = (load) => {
    const existingLike = myLikes.find((l) => l.load_id === load.id);
    likeMutation.mutate({ load, existingLike });
  };

  const { data: myBids = [] } = useQuery({
    queryKey: ['myBids'],
    queryFn: api.loadBids.mine
  });

  const renderPoint = (target, value, onClear, markerIcon, markerColor, placeholder) => (
    <Pressable
      className="flex-1 flex-row items-center gap-1.5 px-3 py-2.5"
      onPress={() => setPickerTarget(target)}
    >
      <Icon source={markerIcon} size={16} color={markerColor} />
      <Text
        numberOfLines={1}
        className={`flex-1 text-sm ${value ? 'font-semibold text-slate-900' : 'text-slate-400'}`}
      >
        {value || placeholder}
      </Text>
      {value ? (
        <TouchableOpacity onPress={onClear} hitSlop={8}>
          <Icon source="close-circle" size={15} color="#94a3b8" />
        </TouchableOpacity>
      ) : null}
    </Pressable>
  );

  return (
    <View className="flex-1 bg-slate-50 px-4 pt-3">
      <View className="mb-4 flex-row items-center rounded-xl border border-slate-300 bg-white">
        {renderPoint(
          'loading',
          loadingLocation,
          () => setLoadingLocation(null),
          'map-marker-outline',
          '#16a34a',
          t('loadingPoint')
        )}
        <Icon source="arrow-right" size={16} color="#f97316" />
        {renderPoint(
          'unloading',
          unloadingLocation,
          () => setUnloadingLocation(null),
          'map-marker-check-outline',
          '#dc2626',
          t('unloadingPoint')
        )}
      </View>

      {showVehiclePicker && (
        <View className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 p-3">
          <View className="mb-2.5 flex-row items-center gap-2">
            <View className="h-7 w-7 items-center justify-center rounded-lg bg-brand">
              <Icon source="truck-fast" size={16} color="#ffffff" />
            </View>
            <Text className="flex-1 text-sm font-bold text-slate-900">{t('loadsForMyVehicle')}</Text>
            {selectedTruck && (
              <TouchableOpacity onPress={() => setSelectedTruckId(null)} hitSlop={8}>
                <Text className="text-xs font-bold text-brand">{t('showAllLoads')}</Text>
              </TouchableOpacity>
            )}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2">
              {trucks.map((truck) => {
                const active = selectedTruck?.id === truck.id;
                // Chips read like an Indian commercial number plate — bold,
                // wide-tracked, and turning that plate's yellow when picked.
                return (
                  <TouchableOpacity
                    key={truck.id}
                    activeOpacity={0.8}
                    onPress={() => setSelectedTruckId(active ? null : truck.id)}
                    className={`flex-row items-center gap-1.5 rounded-lg border-2 px-3 py-2 ${
                      active ? 'border-slate-900 bg-amber-300' : 'border-slate-300 bg-white'
                    }`}
                  >
                    <Icon source="truck-outline" size={14} color={active ? '#0f172a' : '#64748b'} />
                    <Text className={`text-sm font-extrabold tracking-wider ${active ? 'text-slate-900' : 'text-slate-700'}`}>
                      {truck.registration_number}
                    </Text>
                    {active ? <Icon source="check-bold" size={14} color="#0f172a" /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {selectedTruck && (
            <View className="mt-2.5 flex-row items-center gap-1.5">
              <Icon source="filter-check" size={13} color="#c2410c" />
              <Text className="flex-1 text-xs font-medium text-orange-800">{t('showingLoadsForVehicle')}</Text>
            </View>
          )}
        </View>
      )}

      {isLoading ? (
        <ActivityIndicator className="mt-10" />
      ) : (
        <FlatList
          data={visibleLoads}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          renderItem={({ item }) => (
            <LoadCard
              load={item}
              liked={myLikes.some((l) => l.load_id === item.id)}
              onToggleLike={toggleLike}
              bidStatus={myBids.find((b) => b.load_id === item.id)?.status}
            />
          )}
          ListEmptyComponent={
            <Text className="mt-10 text-center text-slate-400">
              {selectedTruck ? t('noLoadsForVehicle') : t('noActiveLoads')}
            </Text>
          }
        />
      )}

      <LocationPickerModal
        visible={pickerTarget !== null}
        title={pickerTarget === 'unloading' ? t('selectUnloadingPoint') : t('selectLoadingPoint')}
        initialValue={pickerTarget === 'unloading' ? unloadingLocation : loadingLocation}
        onApply={(value) =>
          (pickerTarget === 'unloading' ? setUnloadingLocation : setLoadingLocation)(value)
        }
        onClose={() => setPickerTarget(null)}
        t={t}
      />
    </View>
  );
}
