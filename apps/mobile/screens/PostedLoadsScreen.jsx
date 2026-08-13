import { View, Text, ScrollView } from 'react-native';
import { Icon } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import MyLoadRow from '../components/MyLoadRow';

// Full list behind Profile's "Your Posted Loads" nav row — HomeScreen shows
// a capped preview (myLoads.slice(0, 5)) of the same query/component; this
// screen is the uncapped "see everything" destination.
export default function PostedLoadsScreen() {
  const navigation = useNavigation();
  const { t } = useLanguage();
  const { data: myLoads = [] } = useQuery({ queryKey: ['myLoads'], queryFn: api.loads.mine });

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 16 }}>
      {myLoads.length === 0 ? (
        <View className="items-center py-16">
          <Icon source="package-variant-closed" size={40} color="#cbd5e1" />
          <Text className="mt-3 text-sm text-slate-400">{t('noLoadsPostedYet')}</Text>
        </View>
      ) : (
        myLoads.map((load) => <MyLoadRow key={load.id} load={load} t={t} navigation={navigation} />)
      )}
    </ScrollView>
  );
}
