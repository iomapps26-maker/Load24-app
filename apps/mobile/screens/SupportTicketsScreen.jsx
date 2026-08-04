import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { Icon, TextInput, Button } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { SALES_PHONE } from '../lib/contact';

const STATUS_STYLE = {
  open: { bg: 'bg-blue-100', text: 'text-blue-700' },
  in_progress: { bg: 'bg-orange-100', text: 'text-orange-700' },
  resolved: { bg: 'bg-green-100', text: 'text-green-700' },
  closed: { bg: 'bg-slate-100', text: 'text-slate-600' }
};

export default function SupportTicketsScreen() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data: tickets = [] } = useQuery({ queryKey: ['supportTickets'], queryFn: api.supportTickets.mine });

  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const createTicket = useMutation({
    mutationFn: () => api.supportTickets.create({ subject: subject.trim(), message: message.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supportTickets'] });
      setSubject('');
      setMessage('');
      setShowForm(false);
    }
  });

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 16 }}>
      <TouchableOpacity
        className="mb-4 flex-row items-center justify-center rounded-xl bg-green-600 py-3.5"
        onPress={() => Linking.openURL(`tel:${SALES_PHONE}`)}
      >
        <Icon source="phone" size={18} color="white" />
        <Text className="ml-2 text-base font-bold text-white">{t('callSalesTeam')}</Text>
      </TouchableOpacity>

      {showForm ? (
        <View className="mb-4 rounded-2xl border border-slate-200 bg-white p-5">
          <TextInput mode="outlined" label={t('subject')} value={subject} onChangeText={setSubject} className="mb-3" />
          <TextInput
            mode="outlined"
            label={t('message')}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={4}
            className="mb-4"
          />
          <View className="flex-row gap-3">
            <Button mode="outlined" className="flex-1" onPress={() => setShowForm(false)}>
              {t('cancel')}
            </Button>
            <Button
              mode="contained"
              buttonColor="#f97316"
              className="flex-1"
              loading={createTicket.isPending}
              disabled={!subject.trim() || !message.trim() || createTicket.isPending}
              onPress={() => createTicket.mutate()}
            >
              {t('submit')}
            </Button>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          className="mb-4 flex-row items-center justify-center rounded-xl bg-brand py-3.5"
          onPress={() => setShowForm(true)}
        >
          <Icon source="plus" size={18} color="white" />
          <Text className="ml-2 text-base font-bold text-white">{t('raiseNewTicket')}</Text>
        </TouchableOpacity>
      )}

      {tickets.length === 0 ? (
        <View className="items-center py-10">
          <Icon source="file-document-outline" size={40} color="#cbd5e1" />
          <Text className="mt-3 text-sm text-slate-400">{t('noTicketsYet')}</Text>
        </View>
      ) : (
        tickets.map((ticket) => {
          const style = STATUS_STYLE[ticket.status] ?? STATUS_STYLE.open;
          return (
            <View key={ticket.id} className="mb-3 rounded-2xl border border-slate-200 bg-white p-4">
              <View className="mb-1 flex-row items-center justify-between">
                <Text className="flex-1 pr-2 text-base font-bold text-slate-900">{ticket.subject}</Text>
                <View className={`rounded-full px-3 py-1 ${style.bg}`}>
                  <Text className={`text-xs font-semibold ${style.text}`}>{ticket.status}</Text>
                </View>
              </View>
              <Text className="text-sm text-slate-500">{ticket.message}</Text>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}
