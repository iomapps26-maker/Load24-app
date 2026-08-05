import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, Pressable } from 'react-native';
import { TextInput, Button, Icon } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import {
  TRUCK_TYPES, TRUCK_TYPE_LABELS, BODY_TYPES, BODY_TYPE_LABELS,
  FUEL_TYPES, FUEL_LABELS, AXLE_TYPES, AXLE_LABELS
} from '../lib/loadOptions';
import { TRUCK_DOCUMENT_META } from '../lib/truckDocuments';
import DocumentUploadRow from '../components/DocumentUploadRow';
import DateField from '../components/DateField';

const TRUCK_BUCKET = 'truck-documents';

// The load-requirement enums (loadOptions.js) include "any" for filtering
// loads — meaningless for describing a specific truck's own body/fuel/axle,
// so it's dropped here.
const TRUCK_BODY_TYPES = BODY_TYPES.filter((v) => v !== 'any');
const TRUCK_FUEL_TYPES = FUEL_TYPES.filter((v) => v !== 'any');
const TRUCK_AXLE_TYPES = AXLE_TYPES.filter((v) => v !== 'any');

const DOCUMENT_ROWS = [
  { type: 'rc' },
  { type: 'permit', expiryField: 'permit_expiry' },
  { type: 'puc', expiryField: 'puc_expiry' },
  { type: 'insurance', expiryField: 'insurance_expiry' },
  { type: 'photo_front' },
  { type: 'photo_back' },
  { type: 'photo_side' }
];

const EMPTY_FORM = {
  registration_number: '', truck_type: '', tyre_count: '', body_type: '', capacity_tons: '',
  length_ft: '', width_ft: '', owner_name: '', fuel_type: '', axle_type: '',
  permit_expiry: '', puc_expiry: '', insurance_expiry: '',
  driver_name: '', driver_mobile: ''
};

function Field({ label, required, ...props }) {
  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm text-slate-600">{label}{required ? ' *' : ''}</Text>
      <TextInput mode="outlined" dense {...props} />
    </View>
  );
}

// Generic bottom-sheet single-select, used for Vehicle Type / Body Type /
// Fuel Type / Axle Type — same modal-list pattern, just parameterized by
// which enum + label map it's picking from.
function PickerField({ label, required, value, onChange, options, labels, language, t, placeholder }) {
  const [visible, setVisible] = useState(false);
  const displayLabel = value ? labels[language]?.[value] ?? value : placeholder;

  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm text-slate-600">{label}{required ? ' *' : ''}</Text>
      <TouchableOpacity
        className="flex-row items-center justify-between rounded-lg border border-slate-400 px-3 py-3.5"
        onPress={() => setVisible(true)}
      >
        <Text className={value ? 'text-slate-900' : 'text-slate-400'}>{displayLabel}</Text>
        <Icon source="chevron-down" size={18} color="#64748b" />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setVisible(false)}>
          <Pressable className="max-h-[70%] rounded-t-3xl bg-white p-5 pb-8" onPress={() => {}}>
            <Text className="mb-4 text-center text-base font-bold text-slate-900">{label}</Text>
            <ScrollView>
              {options.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  className="flex-row items-center justify-between border-b border-slate-100 py-3"
                  onPress={() => { onChange(opt); setVisible(false); }}
                >
                  <Text className="text-sm text-slate-800">{labels[language]?.[opt] ?? opt}</Text>
                  {value === opt && <Icon source="check" size={18} color="#f97316" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Button mode="text" className="mt-2" onPress={() => setVisible(false)}>
              {t('cancel')}
            </Button>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function indexDocuments(documents) {
  return Object.fromEntries((documents || []).map((d) => [d.document_type, d]));
}

function TruckForm({ initial, onCancel, onSaved, t, language }) {
  const [truckId, setTruckId] = useState(initial?.id ?? null);
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const [documentsByType, setDocumentsByType] = useState(indexDocuments(initial?.documents));
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const set = (key) => (v) => setForm((f) => ({ ...f, [key]: v }));

  // Fetches the full truck (with documents) once it exists, so a freshly
  // created truck's document rows show up without needing to reopen the
  // form — GET /api/trucks (list) doesn't embed documents, only GET /:id does.
  const refetchDocuments = async () => {
    const data = await api.trucks.get(truckId);
    setDocumentsByType(indexDocuments(data.documents));
    queryClient.invalidateQueries({ queryKey: ['trucks'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        tyre_count: form.tyre_count ? Number(form.tyre_count) : undefined,
        capacity_tons: form.capacity_tons ? Number(form.capacity_tons) : undefined,
        length_ft: form.length_ft ? Number(form.length_ft) : undefined,
        width_ft: form.width_ft ? Number(form.width_ft) : undefined
      };
      return truckId ? api.trucks.update(truckId, body) : api.trucks.create(body);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['trucks'] });
      setTruckId(data.id);
      if (!initial) {
        // First save of a brand-new truck — stay on the form so the
        // document rows (which need a truck id) can appear right below.
        return;
      }
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
      <PickerField
        label={t('truckType')} required value={form.truck_type} onChange={set('truck_type')}
        options={TRUCK_TYPES} labels={TRUCK_TYPE_LABELS} language={language} t={t} placeholder={t('selectTruckType')}
      />
      <Field label={t('vehicleTyres')} keyboardType="number-pad" value={String(form.tyre_count)} onChangeText={set('tyre_count')} placeholder={t('vehicleTyresPlaceholder')} />
      <PickerField
        label={t('bodyType')} value={form.body_type} onChange={set('body_type')}
        options={TRUCK_BODY_TYPES} labels={BODY_TYPE_LABELS} language={language} t={t} placeholder={t('selectBodyType')}
      />
      <Field label={t('capacityTons')} keyboardType="decimal-pad" value={String(form.capacity_tons)} onChangeText={set('capacity_tons')} />
      <View className="flex-row gap-3">
        <View className="flex-1"><Field label={t('length')} keyboardType="decimal-pad" value={String(form.length_ft)} onChangeText={set('length_ft')} /></View>
        <View className="flex-1"><Field label={t('width')} keyboardType="decimal-pad" value={String(form.width_ft)} onChangeText={set('width_ft')} /></View>
      </View>
      <PickerField
        label={t('fuelType')} value={form.fuel_type} onChange={set('fuel_type')}
        options={TRUCK_FUEL_TYPES} labels={FUEL_LABELS} language={language} t={t} placeholder={t('selectFuelType')}
      />
      <PickerField
        label={t('axleType')} value={form.axle_type} onChange={set('axle_type')}
        options={TRUCK_AXLE_TYPES} labels={AXLE_LABELS} language={language} t={t} placeholder={t('selectAxleType')}
      />

      <Text className="mb-2 mt-1 text-xs font-semibold uppercase text-slate-400">{t('ownerAndDriver')}</Text>
      <Field label={t('ownerName')} value={form.owner_name} onChangeText={set('owner_name')} />
      <Field label={t('driverName')} value={form.driver_name} onChangeText={set('driver_name')} />
      <Field label={t('driverMobile')} keyboardType="phone-pad" value={form.driver_mobile} onChangeText={set('driver_mobile')} />

      <Text className="mb-2 mt-1 text-xs font-semibold uppercase text-slate-400">{t('documentExpiryDates')}</Text>
      <DateField label={t('permitExpiry')} value={form.permit_expiry} onChange={set('permit_expiry')} />
      <DateField label={t('pucExpiry')} value={form.puc_expiry} onChange={set('puc_expiry')} />
      <DateField label={t('insuranceExpiry')} value={form.insurance_expiry} onChange={set('insurance_expiry')} />

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
          {truckId ? t('save') : t('saveAndContinue')}
        </Button>
      </View>

      <Text className="mb-3 mt-5 text-sm font-semibold text-slate-500">{t('registrationDocs')}</Text>

      {truckId ? (
        <>
          {DOCUMENT_ROWS.map(({ type, expiryField }) => {
            const meta = TRUCK_DOCUMENT_META[type];
            return (
              <View key={type}>
                <DocumentUploadRow
                  bucket={TRUCK_BUCKET}
                  documentType={type}
                  label={meta.labelKey ? t(meta.labelKey) : type}
                  icon={meta.icon}
                  uploadedDoc={documentsByType[type]}
                  getUploadUrl={(documentType, fileName) => api.trucks.uploadUrl(truckId, documentType, fileName)}
                  confirmUpload={(body) => api.trucks.confirmDocument(truckId, body)}
                  onUploaded={refetchDocuments}
                />
                {!!expiryField && !form[expiryField] && (
                  <Text className="mb-3 -mt-2 text-xs text-orange-600">{t('expiryDateReminder')}</Text>
                )}
              </View>
            );
          })}
          <Button mode="contained" buttonColor="#f97316" onPress={onSaved}>
            {t('done')}
          </Button>
        </>
      ) : (
        // Uploads need a truck id to attach to (the storage path and FK both
        // key off it) — until the details above are saved once, show what's
        // coming instead of just... nothing, which is what made this "where
        // do I upload documents" confusing in the first place.
        <>
          <Text className="mb-3 -mt-2 text-xs text-slate-400">{t('documentsUnlockAfterSave')}</Text>
          {DOCUMENT_ROWS.map(({ type }) => {
            const meta = TRUCK_DOCUMENT_META[type];
            return (
              <View key={type} className="mb-3 flex-row items-center rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4 opacity-50">
                <Icon source={meta.icon} size={22} color="#94a3b8" />
                <Text className="ml-3 flex-1 text-sm font-semibold text-slate-500">{meta.labelKey ? t(meta.labelKey) : type}</Text>
                <Icon source="lock-outline" size={18} color="#94a3b8" />
              </View>
            );
          })}
        </>
      )}
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

  const openEdit = async (truck) => {
    // The list endpoint doesn't embed documents — fetch the full record
    // (with documents) before opening the edit form.
    const full = await api.trucks.get(truck.id);
    setFormState(full);
  };

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
        <TruckCard key={truck.id} truck={truck} onEdit={openEdit} t={t} language={language} />
      ))}
    </ScrollView>
  );
}
