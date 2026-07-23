import { useState } from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { ActivityIndicator, Chip, TextInput } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import LoadCard from '../components/LoadCard';

const TRUCK_TYPES = ['all', 'tata_407', 'tata_ace', 'eicher_truck', 'container', 'trailer'];

// Mobile port of src/pages/FindLoads.jsx: same three queries (loads, my likes,
// profile) plus an optimistic like/unlike mutation, now via the Express API.
export default function FindLoadsScreen() {
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [truckType, setTruckType] = useState('all');
  const [pincode, setPincode] = useState('');

  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: api.profile.me });

  const {
    data: loads = [],
    isLoading,
    isRefetching,
    refetch
  } = useQuery({
    queryKey: ['loads', truckType, pincode],
    queryFn: () => api.loads.list({ truck_type: truckType, pincode: pincode || undefined })
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
      <TextInput
        mode="outlined"
        placeholder={t('searchByPincode')}
        value={pincode}
        onChangeText={setPincode}
        dense
        className="mb-3"
      />
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={TRUCK_TYPES}
        keyExtractor={(item) => item}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 8, paddingVertical: 4, paddingRight: 16 }}
        renderItem={({ item }) => {
          const selected = truckType === item;
          return (
            <Chip
              selected={selected}
              onPress={() => setTruckType(item)}
              style={{
                backgroundColor: selected ? '#f97316' : '#ffffff',
                borderColor: selected ? '#f97316' : '#e2e8f0',
                borderWidth: 1
              }}
              textStyle={{ color: selected ? '#ffffff' : '#334155', fontWeight: '600' }}
              selectedColor={selected ? '#ffffff' : '#334155'}
            >
              {item.replace(/_/g, ' ')}
            </Chip>
          );
        }}
      />
      <View className="mb-3" />

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
