import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, Pressable } from 'react-native';
import { TextInput, Button, Icon } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { TRUCK_TYPES, TRUCK_TYPE_LABELS } from '../lib/loadOptions';

const EMPTY_FORM = {
  registration_number: '', truck_type: '', capacity_tons: '', chassis_number: '', engine_number: '',
  manufacturing_year: '', rc_number: '', rc_expiry: '', insurance_number: '', insurance_expiry: '',
  permit_number: '', permit_expiry: '', fitness_expiry: '', puc_expiry: '',
  driver_name: '', driver_mobile: '', driver_license_number: ''
};

function Field({ label, required, ...props }) {
  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm text-slate-600">{label}{required ? ' *' : ''}</Text>
      <TextInput mode="outlined" dense {...props} />
    </View>
  );
}

function TruckTypePicker({ value, onChange, t, language }) {
  const [visible, setVisible] = useState(false);
  const label = value ? TRUCK_TYPE_LABELS[language]?.[value] ?? value : t('selectTruckType');

  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm text-slate-600">{t('truckType')} *</Text>
      <TouchableOpacity
        className="flex-row items-center justify-between rounded-lg border border-slate-400 px-3 py-3.5"
        onPress={() => setVisible(true)}
      >
        <Text className={value ? 'text-slate-900' : 'text-slate-400'}>{label}</Text>
        <Icon source="chevron-down" size={18} color="#64748b" />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setVisible(false)}>
          <Pressable className="max-h-[70%] rounded-t-3xl bg-white p-5 pb-8" onPress={() => {}}>
            <Text className="mb-4 text-center text-base font-bold text-slate-900">{t('selectTruckType')}</Text>
            <ScrollView>
              {TRUCK_TYPES.map((type) => (
                <TouchableOpacity
                  key={type}
                  className="flex-row items-center justify-between border-b border-slate-100 py-3"
                  onPress={() => { onChange(type); setVisible(false); }}
                >
                  <Text className="text-sm text-slate-800">{TRUCK_TYPE_LABELS[language]?.[type] ?? type}</Text>
                  {value === type && <Icon source="check" size={18} color="#f97316" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function TruckForm({ initial, onCancel, onSaved, t, language }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const set = (key) => (v) => setForm((f) => ({ ...f, [key]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        capacity_tons: form.capacity_tons ? Number(form.capacity_tons) : undefined,
        manufacturing_year: form.manufacturing_year ? Number(form.manufacturing_year) : undefined
      };
      return initial?.id ? api.trucks.update(initial.id, body) : api.trucks.create(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trucks'] });
      onSaved();
    },
    onError: (err) => setError(err.message)
  });

  const canSave = form.registration_number.trim() && form.truck_type;

  return (
    <View className="mb-4 rounded-2xl border border-slate-200 bg-white p-5">
      <Text className="mb-4 text-base font-bold text-slate-900">
        {initial?.id ? t('editTruck') : t('addTruck')}
      </Text>

      <Field label={t('registrationNumber')} required autoCapitalize="characters" value={form.registration_number} onChangeText={set('registration_number')} />
      <TruckTypePicker value={form.truck_type} onChange={set('truck_type')} t={t} language={language} />
      <Field label={t('capacityTons')} keyboardType="decimal-pad" value={String(form.capacity_tons)} onChangeText={set('capacity_tons')} />

      <Text className="mb-2 mt-1 text-xs font-semibold uppercase text-slate-400">{t('registrationDocs')}</Text>
      <Field label={t('rcNumber')} value={form.rc_number} onChangeText={set('rc_number')} />
      <Field label={t('rcExpiry')} placeholder="YYYY-MM-DD" value={form.rc_expiry} onChangeText={set('rc_expiry')} />
      <Field label={t('insuranceNumber')} value={form.insurance_number} onChangeText={set('insurance_number')} />
      <Field label={t('insuranceExpiry')} placeholder="YYYY-MM-DD" value={form.insurance_expiry} onChangeText={set('insurance_expiry')} />
      <Field label={t('permitNumber')} value={form.permit_number} onChangeText={set('permit_number')} />
      <Field label={t('permitExpiry')} placeholder="YYYY-MM-DD" value={form.permit_expiry} onChangeText={set('permit_expiry')} />
      <Field label={t('fitnessExpiry')} placeholder="YYYY-MM-DD" value={form.fitness_expiry} onChangeText={set('fitness_expiry')} />
      <Field label={t('pucExpiry')} placeholder="YYYY-MM-DD" value={form.puc_expiry} onChangeText={set('puc_expiry')} />

      <Text className="mb-2 mt-1 text-xs font-semibold uppercase text-slate-400">{t('vehicleIdentity')}</Text>
      <Field label={t('chassisNumber')} value={form.chassis_number} onChangeText={set('chassis_number')} />
      <Field label={t('engineNumber')} value={form.engine_number} onChangeText={set('engine_number')} />
      <Field label={t('manufacturingYear')} keyboardType="number-pad" value={String(form.manufacturing_year)} onChangeText={set('manufacturing_year')} />

      <Text className="mb-2 mt-1 text-xs font-semibold uppercase text-slate-400">{t('driverDetails')}</Text>
      <Field label={t('driverName')} value={form.driver_name} onChangeText={set('driver_name')} />
      <Field label={t('driverMobile')} keyboardType="phone-pad" value={form.driver_mobile} onChangeText={set('driver_mobile')} />
      <Field label={t('driverLicenseNumber')} value={form.driver_license_number} onChangeText={set('driver_license_number')} />

      {!!error && <Text className="mb-3 text-xs text-red-600">{error}</Text>}

      <View className="mt-2 flex-row gap-3">
        <Button mode="outlined" className="flex-1" onPress={onCancel}>{t('cancel')}</Button>
        <Button
          mode="contained"
          buttonColor="#f97316"
          className="flex-1"
          loading={save.isPending}
          disabled={!canSave || save.isPending}
          onPress={() => { setError(''); save.mutate(); }}
        >
          {t('save')}
        </Button>
      </View>
    </View>
  );
}

function TruckCard({ truck, onEdit, t, language }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.trucks.remove(truck.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trucks'] }),
    onError: (err) => Alert.alert(t('deleteTruck'), err.message)
  });

  const confirmDelete = () => {
    Alert.alert(t('deleteTruck'), t('deleteTruckConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('deleteTruck'), style: 'destructive', onPress: () => remove.mutate() }
    ]);
  };

  return (
    <View className="mb-3 rounded-2xl border border-slate-200 bg-white p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 flex-row items-center">
          <View className="mr-3 h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
            <Icon source="truck-outline" size={22} color="#334155" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-bold text-slate-900">{truck.registration_number}</Text>
            <Text className="text-sm text-slate-500">
              {TRUCK_TYPE_LABELS[language]?.[truck.truck_type] ?? truck.truck_type}
              {truck.capacity_tons ? ` · ${truck.capacity_tons} ${t('ton')}` : ''}
            </Text>
          </View>
        </View>
        <View className={`rounded-full px-3 py-1 ${truck.verified ? 'bg-green-100' : 'bg-orange-100'}`}>
          <Text className={`text-xs font-semibold ${truck.verified ? 'text-green-700' : 'text-orange-700'}`}>
            {truck.verified ? t('truckVerified') : t('truckNotVerified')}
          </Text>
        </View>
      </View>

      <View className="mt-3 flex-row gap-3">
        <TouchableOpacity className="flex-row items-center" onPress={() => onEdit(truck)}>
          <Icon source="pencil-outline" size={16} color="#334155" />
          <Text className="ml-1 text-sm font-semibold text-slate-700">{t('edit')}</Text>
        </TouchableOpacity>
        <TouchableOpacity className="flex-row items-center" onPress={confirmDelete} disabled={remove.isPending}>
          <Icon source="trash-can-outline" size={16} color="#dc2626" />
          <Text className="ml-1 text-sm font-semibold text-red-600">{t('deleteTruck')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function TruckDetailsScreen() {
  const { t, language } = useLanguage();
  const { data: trucks, isLoading } = useQuery({ queryKey: ['trucks'], queryFn: api.trucks.mine });
  const [formState, setFormState] = useState(null); // null | 'new' | truck object

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 20 }}>
      {formState ? (
        <TruckForm
          initial={formState === 'new' ? null : formState}
          onCancel={() => setFormState(null)}
          onSaved={() => setFormState(null)}
          t={t}
          language={language}
        />
      ) : (
        <TouchableOpacity
          className="mb-4 flex-row items-center justify-center rounded-2xl border-2 border-dashed border-brand py-4"
          onPress={() => setFormState('new')}
        >
          <Icon source="plus" size={18} color="#f97316" />
          <Text className="ml-2 text-sm font-bold text-brand">{t('addTruck')}</Text>
        </TouchableOpacity>
      )}

      {(trucks || []).length === 0 && !formState && (
        <Text className="mt-2 text-center text-sm text-slate-400">{t('noTrucksYet')}</Text>
      )}

      {(trucks || []).map((truck) => (
        <TruckCard key={truck.id} truck={truck} onEdit={setFormState} t={t} language={language} />
      ))}
    </ScrollView>
  );
}
