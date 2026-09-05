import { View, Text, ScrollView } from 'react-native';
import { Icon } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import MyBidRow from '../components/MyBidRow';

// Full list behind Profile's "Trip History" nav row — every bid the caller
// has placed as the accepter, whatever it ended up as (pending/approved/
// rejected), newest first (GET /api/load-bids/mine already orders that way).
// HomeScreen's "Your Trips" only ever shows a capped preview of the approved
// ones; this is the "see everything" destination, so a declined or
// never-actioned bid doesn't just disappear with nowhere to check on it.
export default function TripHistoryScreen() {
  const navigation = useNavigation();
  const { t } = useLanguage();
  const { data: myBids = [] } = useQuery({ queryKey: ['myBids'], queryFn: api.loadBids.mine });

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 16 }}>
      {myBids.length === 0 ? (
        <View className="items-center py-16">
          <Icon source="truck-fast-outline" size={40} color="#cbd5e1" />
          <Text className="mt-3 text-sm text-slate-400">{t('noBidsPlacedYet')}</Text>
        </View>
      ) : (
        myBids.map((bid) => <MyBidRow key={bid.id} bid={bid} t={t} navigation={navigation} />)
      )}
    </ScrollView>
  );
}
