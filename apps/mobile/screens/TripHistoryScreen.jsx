import { View, Text, ScrollView } from 'react-native';
import { Icon } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import MyBidRow from '../components/MyBidRow';
import MyLoadTripRow from '../components/MyLoadTripRow';

// Full list behind Profile's "Trip History" nav row — every trip the caller
// is a party to, either side: a bid they placed on someone else's load
// (GET /api/load-bids/mine, whatever it ended up as — pending/approved/
// rejected), and a load they posted that someone else's bid turned into a
// trip (GET /api/loads?mine=true, filtered to the ones carrying a `booking`
// — a still-open posting with no accepted bid isn't a trip yet). A
// dual-role account (posts loads AND bids on others') would otherwise see
// only half its activity here; merging both into one list, newest first,
// is what makes this genuinely "trip history" instead of "bids I've placed".
// HomeScreen's "Your Trips" only ever shows a capped preview of the
// caller's own approved bids; this is the "see everything" destination, so
// nothing — a declined bid, a cancelled trip, either side — just disappears
// with nowhere to check on it.
export default function TripHistoryScreen() {
  const navigation = useNavigation();
  const { t } = useLanguage();
  const { data: myBids = [] } = useQuery({ queryKey: ['myBids'], queryFn: api.loadBids.mine });
  const { data: myLoads = [] } = useQuery({ queryKey: ['myLoads'], queryFn: api.loads.mine });

  const postedTrips = myLoads.filter((load) => load.booking);
  const items = [
    ...myBids.map((bid) => ({ key: `bid-${bid.id}`, date: bid.created_at, node: <MyBidRow bid={bid} t={t} navigation={navigation} /> })),
    ...postedTrips.map((load) => ({ key: `load-${load.id}`, date: load.created_at, node: <MyLoadTripRow load={load} t={t} navigation={navigation} /> }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 16 }}>
      {items.length === 0 ? (
        <View className="items-center py-16">
          <Icon source="truck-fast-outline" size={40} color="#cbd5e1" />
          <Text className="mt-3 text-sm text-slate-400">{t('noTripsYet')}</Text>
        </View>
      ) : (
        items.map((item) => <View key={item.key}>{item.node}</View>)
      )}
    </ScrollView>
  );
}
