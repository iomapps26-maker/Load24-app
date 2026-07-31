import { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Icon } from 'react-native-paper';
import { useRoute } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import LoadCard from '../components/LoadCard';

function msRemaining(bid) {
  return new Date(bid.expires_at).getTime() - Date.now();
}

function BidRow({ bid, onApprove, onReject, approving, rejecting }) {
  const { t } = useLanguage();
  const [remainingMs, setRemainingMs] = useState(() => msRemaining(bid));

  useEffect(() => {
    if (bid.status !== 'pending') return undefined;
    const interval = setInterval(() => setRemainingMs(msRemaining(bid)), 1000);
    return () => clearInterval(interval);
  }, [bid]);

  const stillOpen = bid.status === 'pending' && remainingMs > 0;
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  const statusStyle = {
    approved: { bg: 'bg-green-100', text: 'text-green-700', label: t('bidApproved') },
    rejected: { bg: 'bg-red-100', text: 'text-red-700', label: t('bidRejected') },
    pending: { bg: 'bg-orange-100', text: 'text-orange-700', label: stillOpen ? `${t('bidPending')} · 0:${String(seconds).padStart(2, '0')}` : t('bidRejected') }
  }[bid.status] ?? { bg: 'bg-slate-100', text: 'text-slate-700', label: bid.status };

  return (
    <View className="mb-3 rounded-2xl border border-slate-200 bg-white p-4">
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-xl font-extrabold text-slate-900">₹{Number(bid.amount).toLocaleString('en-IN')}</Text>
          <Text className="text-xs text-slate-400">{bid.bid_by_email}{bid.truck_number ? ` · ${bid.truck_number}` : ''}</Text>
        </View>
        <View className={`rounded-full px-3 py-1 ${statusStyle.bg}`}>
          <Text className={`text-xs font-bold ${statusStyle.text}`}>{statusStyle.label}</Text>
        </View>
      </View>

      {stillOpen && (
        <View className="mt-3 flex-row gap-2">
          <TouchableOpacity
            onPress={() => onReject(bid.id)}
            disabled={approving || rejecting}
            className="flex-1 items-center rounded-xl border-2 border-red-500 py-2.5"
          >
            <Text className="text-sm font-bold text-red-600">{t('reject')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onApprove(bid.id)}
            disabled={approving || rejecting}
            className="flex-1 items-center rounded-xl bg-green-600 py-2.5"
          >
            <Text className="text-sm font-bold text-white">{t('approve')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// Poster-only screen: shows one load exactly as it appears on the load feed,
// plus every bid placed against it. Bids auto-reject 1 minute after being
// placed if the poster hasn't approved/rejected — GET /api/load-bids/load/:id
// flips any expired pending bid on the server on every read, so a short
// refetchInterval here is enough to reflect that without a client-side write.
export default function SeeBiddingScreen() {
  const route = useRoute();
  const { loadId } = route.params;
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['loadBids', loadId],
    queryFn: () => api.loadBids.forLoad(loadId),
    refetchInterval: 5000
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['loadBids', loadId] });
  const approveMutation = useMutation({ mutationFn: (id) => api.loadBids.approve(id), onSuccess: invalidate });
  const rejectMutation = useMutation({ mutationFn: (id) => api.loadBids.reject(id), onSuccess: invalidate });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator color="#f97316" />
      </View>
    );
  }

  const { load, bids = [] } = data || {};

  return (
    <ScrollView className="flex-1 bg-slate-50 px-4 pt-4">
      {!!load && <LoadCard load={load} hideActions />}

      <Text className="mb-3 text-lg font-bold text-slate-900">{t('allBids')}</Text>
      {bids.length === 0 ? (
        <Text className="mt-4 text-center text-slate-400">{t('noBidsYet')}</Text>
      ) : (
        bids.map((bid) => (
          <BidRow
            key={bid.id}
            bid={bid}
            onApprove={(id) => approveMutation.mutate(id)}
            onReject={(id) => rejectMutation.mutate(id)}
            approving={approveMutation.isPending}
            rejecting={rejectMutation.isPending}
          />
        ))
      )}
    </ScrollView>
  );
}
