import { useState } from 'react';
import { View, Text, FlatList, Pressable, TouchableOpacity, RefreshControl } from 'react-native';
import { ActivityIndicator, Icon } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import LoadCard from '../components/LoadCard';
import LocationPickerModal from '../components/LocationPickerModal';

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

  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: api.profile.me });

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

      {isLoading ? (
        <ActivityIndicator className="mt-10" />
      ) : (
        <FlatList
          data={loads}
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
            <Text className="mt-10 text-center text-slate-400">{t('noActiveLoads')}</Text>
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
