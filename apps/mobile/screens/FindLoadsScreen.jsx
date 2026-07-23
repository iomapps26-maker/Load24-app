import { useState } from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { ActivityIndicator, Button, Menu, TextInput } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { TRUCK_TYPES as ALL_TRUCK_TYPES, TRUCK_TYPE_LABELS } from '../lib/loadOptions';
import LoadCard from '../components/LoadCard';

// Same enum PostLoadScreen posts with, plus "all" — every filter here mirrors
// a field collected on the Post Load form so shippers/vehicle owners can
// search by exactly what was posted.
const TRUCK_TYPES = ['all', ...ALL_TRUCK_TYPES];

// Mobile port of src/pages/FindLoads.jsx: same three queries (loads, my likes,
// profile) plus an optimistic like/unlike mutation, now via the Express API.
export default function FindLoadsScreen() {
  const queryClient = useQueryClient();
  const { language, t } = useLanguage();
  const [truckType, setTruckType] = useState('all');
  const [pincode, setPincode] = useState('');
  const [materialType, setMaterialType] = useState('');
  const [filterMenuVisible, setFilterMenuVisible] = useState(false);

  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: api.profile.me });

  const {
    data: loads = [],
    isLoading,
    isRefetching,
    refetch
  } = useQuery({
    queryKey: ['loads', truckType, pincode, materialType],
    queryFn: () => api.loads.list({
      truck_type: truckType,
      pincode: pincode || undefined,
      material_type: materialType || undefined
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

  return (
    <View className="flex-1 bg-slate-50 px-4 pt-3">
      <View className="mb-3 flex-row gap-2">
        <TextInput
          mode="outlined"
          placeholder={t('searchByPincode')}
          value={pincode}
          onChangeText={setPincode}
          dense
          style={{ flex: 1 }}
        />
        <TextInput
          mode="outlined"
          placeholder={t('material')}
          value={materialType}
          onChangeText={setMaterialType}
          dense
          style={{ flex: 1 }}
        />
      </View>
      <View className="mb-4">
        <Menu
          visible={filterMenuVisible}
          onDismiss={() => setFilterMenuVisible(false)}
          anchor={
            <Button
              mode="outlined"
              onPress={() => setFilterMenuVisible(true)}
              icon="chevron-down"
              contentStyle={{ flexDirection: 'row-reverse' }}
              textColor="#334155"
              style={{ borderColor: '#e2e8f0', alignSelf: 'flex-start' }}
            >
              {truckType === 'all' ? t('allTrucks') : (TRUCK_TYPE_LABELS[language]?.[truckType] ?? truckType.replace(/_/g, ' '))}
            </Button>
          }
        >
          {TRUCK_TYPES.map((item) => (
            <Menu.Item
              key={item}
              onPress={() => {
                setTruckType(item);
                setFilterMenuVisible(false);
              }}
              title={item === 'all' ? t('allTrucks') : (TRUCK_TYPE_LABELS[language]?.[item] ?? item.replace(/_/g, ' '))}
              titleStyle={truckType === item ? { color: '#f97316', fontWeight: '700' } : undefined}
            />
          ))}
        </Menu>
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
            />
          )}
          ListEmptyComponent={
            <Text className="mt-10 text-center text-slate-400">{t('noActiveLoads')}</Text>
          }
        />
      )}
    </View>
  );
}
