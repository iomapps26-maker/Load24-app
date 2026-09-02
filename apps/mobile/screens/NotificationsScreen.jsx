import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Icon } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { navigateForNotification } from '../lib/notificationRouting';

// One icon/color per event type — falls back to a plain bell for anything
// this screen doesn't know about yet, so a new backend notification type
// never renders as a blank row.
const TYPE_STYLE = {
  bid_placed: { icon: 'gavel', bg: 'bg-blue-100', color: '#2563eb' },
  bid_approved: { icon: 'check-circle-outline', bg: 'bg-green-100', color: '#16a34a' },
  bid_rejected: { icon: 'close-circle-outline', bg: 'bg-red-100', color: '#dc2626' },
  wallet_credited: { icon: 'wallet-plus-outline', bg: 'bg-green-100', color: '#16a34a' },
  withdrawal_approved: { icon: 'bank-check', bg: 'bg-blue-100', color: '#2563eb' },
  withdrawal_rejected: { icon: 'bank-off-outline', bg: 'bg-red-100', color: '#dc2626' },
  withdrawal_paid: { icon: 'cash-check', bg: 'bg-green-100', color: '#16a34a' },
  kyc_verified: { icon: 'shield-check-outline', bg: 'bg-green-100', color: '#16a34a' },
  kyc_rejected: { icon: 'shield-alert-outline', bg: 'bg-red-100', color: '#dc2626' },
  bank_account_verified: { icon: 'bank-check', bg: 'bg-green-100', color: '#16a34a' },
  bank_account_rejected: { icon: 'bank-off-outline', bg: 'bg-red-100', color: '#dc2626' },
  truck_verified: { icon: 'truck-check-outline', bg: 'bg-green-100', color: '#16a34a' },
  truck_availability_offered: { icon: 'truck-fast-outline', bg: 'bg-blue-100', color: '#2563eb' },
  truck_available_nearby: { icon: 'truck-outline', bg: 'bg-blue-100', color: '#2563eb' },
  load_available_nearby: { icon: 'package-variant-closed', bg: 'bg-orange-100', color: '#ea580c' }
};
const DEFAULT_STYLE = { icon: 'bell-outline', bg: 'bg-slate-100', color: '#334155' };

function timeAgo(iso, t) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t('justNow');
  if (mins < 60) return `${mins}${t('minsAgoSuffix')}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}${t('hoursAgoSuffix')}`;
  const days = Math.floor(hours / 24);
  return `${days}${t('daysAgoSuffix')}`;
}

// The red "delete" action revealed by swiping a row left or right — tapping
// it (or letting the swipe carry past its own width) removes the
// notification for good, same "swipe away = gone" behavior as mail/other
// notification-feed apps use instead of hoarding every row forever.
function DeleteAction({ onPress, t, side }) {
  return (
    <View className={`mb-3 w-20 ${side === 'left' ? 'mr-3' : 'ml-3'}`}>
      <TouchableOpacity className="flex-1 items-center justify-center rounded-2xl bg-red-500" onPress={onPress}>
        <Icon source="trash-can-outline" size={20} color="white" />
        <Text className="mt-1 text-xs font-semibold text-white">{t('delete')}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function NotificationsScreen() {
  const navigation = useNavigation();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data: notifications = [] } = useQuery({ queryKey: ['notifications'], queryFn: api.notifications.mine });

  const markRead = useMutation({
    mutationFn: (id) => api.notifications.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] })
  });
  const markAllRead = useMutation({
    mutationFn: api.notifications.markAllRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] })
  });

  // Optimistic remove so the row disappears the moment the swipe completes,
  // rather than sitting there until the DELETE round-trip finishes. Rolled
  // back on failure; either way a background refetch reconciles with the
  // server, which is now the only place this list lives — nothing is kept
  // around locally, so a deleted notification never comes back on next login.
  const removeNotification = useMutation({
    mutationFn: (id) => api.notifications.remove(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const previous = queryClient.getQueryData(['notifications']);
      queryClient.setQueryData(['notifications'], (old = []) => old.filter((n) => n.id !== id));
      return { previous };
    },
    onError: (err, id, context) => {
      if (context?.previous) queryClient.setQueryData(['notifications'], context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] })
  });

  const handlePress = (notification) => {
    if (!notification.read_at) markRead.mutate(notification.id);
    navigateForNotification(navigation, notification);
  };

  const hasUnread = notifications.some((n) => !n.read_at);

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 16 }}>
      {hasUnread && (
        <TouchableOpacity className="mb-4 self-end" onPress={() => markAllRead.mutate()}>
          <Text className="text-sm font-semibold text-brand">{t('markAllRead')}</Text>
        </TouchableOpacity>
      )}

      {notifications.length === 0 ? (
        <View className="items-center py-16">
          <Icon source="bell-outline" size={40} color="#cbd5e1" />
          <Text className="mt-3 text-sm text-slate-400">{t('noNotificationsYet')}</Text>
        </View>
      ) : (
        notifications.map((notification) => {
          const style = TYPE_STYLE[notification.type] ?? DEFAULT_STYLE;
          const unread = !notification.read_at;
          return (
            <Swipeable
              key={notification.id}
              overshootRight={false}
              overshootLeft={false}
              renderLeftActions={() => <DeleteAction t={t} side="left" onPress={() => removeNotification.mutate(notification.id)} />}
              renderRightActions={() => <DeleteAction t={t} side="right" onPress={() => removeNotification.mutate(notification.id)} />}
            >
              <TouchableOpacity
                className={`mb-3 flex-row rounded-2xl border p-4 ${unread ? 'border-brand/40 bg-orange-50' : 'border-slate-200 bg-white'}`}
                onPress={() => handlePress(notification)}
              >
                <View className={`mr-3 h-10 w-10 items-center justify-center rounded-full ${style.bg}`}>
                  <Icon source={style.icon} size={18} color={style.color} />
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center justify-between">
                    <Text className="flex-1 pr-2 text-sm font-bold text-slate-900">{notification.title}</Text>
                    {unread && <View className="h-2 w-2 rounded-full bg-brand" />}
                  </View>
                  {!!notification.body && <Text className="mt-1 text-sm text-slate-500">{notification.body}</Text>}
                  <Text className="mt-2 text-xs text-slate-400">{timeAgo(notification.created_at, t)}</Text>
                </View>
              </TouchableOpacity>
            </Swipeable>
          );
        })
      )}
    </ScrollView>
  );
}
