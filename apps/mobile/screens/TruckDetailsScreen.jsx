import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, Pressable } from 'react-native';
import { TextInput, Button, Icon } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import ConfirmDetailsCheckbox from '../components/ConfirmDetailsCheckbox';
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
// so it's dropped here. Vehicle Type also drops open_body/closed_body/
// container — redundant with the separate Body Type field below, which
// already asks that same open/closed/container question.
const TRUCK_TYPES_NO_BODY_OVERLAP = TRUCK_TYPES.filter((v) => !['open_body', 'closed_body', 'container'].includes(v));
const TRUCK_BODY_TYPES = BODY_TYPES.filter((v) => v !== 'any');
const TRUCK_FUEL_TYPES = FUEL_TYPES.filter((v) => v !== 'any');
const TRUCK_AXLE_TYPES = AXLE_TYPES.filter((v) => v !== 'any');

// Vehicle Type and Body Type get an extra "other" option (with a free-text
// follow-up field) on top of the shared enum — loadOptions.js itself isn't
// touched since PostLoadScreen/FindLoadsScreen also rely on it and a truck's
// own type isn't the same list as a load's required truck type semantically,
// they just happen to reuse the same closed set today.
const TRUCK_TYPE_OPTIONS = [...TRUCK_TYPES_NO_BODY_OVERLAP, 'other'];
const TRUCK_TYPE_LABELS_WITH_OTHER = {
  en: { ...TRUCK_TYPE_LABELS.en, other: 'Other' },
  hi: { ...TRUCK_TYPE_LABELS.hi, other: 'अन्य' }
};
const TRUCK_BODY_TYPE_OPTIONS = [...TRUCK_BODY_TYPES, 'other'];
const BODY_TYPE_LABELS_WITH_OTHER = {
  en: { ...BODY_TYPE_LABELS.en, other: 'Other' },
  hi: { ...BODY_TYPE_LABELS.hi, other: 'अन्य' }
};
const TRUCK_FUEL_TYPE_OPTIONS = [...TRUCK_FUEL_TYPES, 'other'];
const FUEL_LABELS_WITH_OTHER = {
  en: { ...FUEL_LABELS.en, other: 'Other' },
  hi: { ...FUEL_LABELS.hi, other: 'अन्य' }
};

// RC, Insurance, and the three vehicle photos are the documents staff
// actually need to verify a truck — Permit and PUC are situational (not
// every truck/route needs one on hand yet), so only the first group is
// required to finish the Documents step.
const DOCUMENT_ROWS = [
  { type: 'rc', required: true },
  { type: 'permit', expiryField: 'permit_expiry' },
  { type: 'puc', expiryField: 'puc_expiry' },
  { type: 'insurance', expiryField: 'insurance_expiry', required: true },
  { type: 'photo_front', required: true },
  { type: 'photo_back', required: true },
  { type: 'photo_side', required: true }
];

const EMPTY_FORM = {
  registration_number: '', truck_type: '', truck_type_other: '', tyre_count: '', body_type: '', body_type_other: '', capacity_tons: '',
  length_ft: '', width_ft: '', owner_name: '', owner_mobile: '', fuel_type: '', fuel_type_other: '', axle_type: '',
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

// owner_name/owner_mobile/tyre_count/body_type/fuel_type/axle_type/length_ft/
// width_ft/*_other were all added to trucks via later migrations as nullable
// columns with no backfill, and POST /api/trucks only actually requires
// registration_number + truck_type server-side — so an existing truck can
// have any of these as null even though this form treats them as required.
// Left as null they render as the literal string "null" (every field below
// gets String()'d for display) and crash Save the moment getValidationErrors
// calls .trim() on one, so fold every null/undefined back to EMPTY_FORM's ''
// before it ever reaches state.
function mergeFormState(initial) {
  const merged = { ...EMPTY_FORM, ...initial };
  for (const key of Object.keys(EMPTY_FORM)) {
    if (merged[key] == null) merged[key] = EMPTY_FORM[key];
  }
  return merged;
}

function TruckForm({ initial, onCancel, onSaved, t, language }) {
  const [truckId, setTruckId] = useState(initial?.id ?? null);
  const [form, setForm] = useState(() => mergeFormState(initial));
  const [documentsByType, setDocumentsByType] = useState(indexDocuments(initial?.documents));
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
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

  // Every vehicle-spec/owner field is required except Driver Name/Mobile —
  // a truck can be registered before a driver is assigned, so those two stay
  // optional. "other" picks additionally require their free-text detail.
  // Named per-field (not just a boolean) so a failed Save can say exactly
  // what's missing instead of leaving the button silently greyed out.
  // String(value || '') everywhere a field gets trimmed — never call .trim()
  // on the raw form value directly, since a null/undefined here (see
  // mergeFormState above) would throw and crash the app instead of showing
  // "what's missing".
  const getValidationErrors = () => {
    const errors = [];
    if (!String(form.registration_number || '').trim()) errors.push(t('registrationNumber'));
    if (!form.truck_type) errors.push(t('truckType'));
    else if (form.truck_type === 'other' && !String(form.truck_type_other || '').trim()) errors.push(t('specifyTruckType'));
    if (!String(form.tyre_count || '').trim()) errors.push(t('vehicleTyres'));
    if (!form.body_type) errors.push(t('bodyType'));
    else if (form.body_type === 'other' && !String(form.body_type_other || '').trim()) errors.push(t('specifyBodyType'));
    if (!String(form.capacity_tons || '').trim()) errors.push(t('capacityTons'));
    if (!String(form.length_ft || '').trim()) errors.push(t('length'));
    if (!String(form.width_ft || '').trim()) errors.push(t('width'));
    if (!form.fuel_type) errors.push(t('fuelType'));
    else if (form.fuel_type === 'other' && !String(form.fuel_type_other || '').trim()) errors.push(t('specifyFuelType'));
    if (!form.axle_type) errors.push(t('axleType'));
    if (!String(form.owner_name || '').trim()) errors.push(t('ownerName'));
    if (!String(form.owner_mobile || '').trim()) errors.push(t('ownerMobile'));
    return errors;
  };

  const requiredDocsUploaded = DOCUMENT_ROWS
    .filter((row) => row.required)
    .every((row) => !!documentsByType[row.type]);

  return (
    <View className="mb-4 rounded-2xl border border-slate-200 bg-white p-5">
      <Text className="mb-4 text-base font-bold text-slate-900">
        {initial?.id ? t('editTruck') : t('addTruck')}
      </Text>

      <Field label={t('registrationNumber')} required autoCapitalize="characters" value={form.registration_number} onChangeText={set('registration_number')} />
      <PickerField
        label={t('truckType')} required value={form.truck_type} onChange={set('truck_type')}
        options={TRUCK_TYPE_OPTIONS} labels={TRUCK_TYPE_LABELS_WITH_OTHER} language={language} t={t} placeholder={t('selectTruckType')}
      />
      {form.truck_type === 'other' && (
        <Field label={t('specifyTruckType')} value={form.truck_type_other} onChangeText={set('truck_type_other')} />
      )}
      <Field label={t('vehicleTyres')} required keyboardType="number-pad" value={String(form.tyre_count)} onChangeText={set('tyre_count')} placeholder={t('vehicleTyresPlaceholder')} />
      <PickerField
        label={t('bodyType')} required value={form.body_type} onChange={set('body_type')}
        options={TRUCK_BODY_TYPE_OPTIONS} labels={BODY_TYPE_LABELS_WITH_OTHER} language={language} t={t} placeholder={t('selectBodyType')}
      />
      {form.body_type === 'other' && (
        <Field label={t('specifyBodyType')} value={form.body_type_other} onChangeText={set('body_type_other')} />
      )}
      <Field label={t('capacityTons')} required keyboardType="decimal-pad" value={String(form.capacity_tons)} onChangeText={set('capacity_tons')} />
      <View className="flex-row gap-3">
        <View className="flex-1"><Field label={t('length')} required keyboardType="decimal-pad" value={String(form.length_ft)} onChangeText={set('length_ft')} /></View>
        <View className="flex-1"><Field label={t('width')} required keyboardType="decimal-pad" value={String(form.width_ft)} onChangeText={set('width_ft')} /></View>
      </View>
      <PickerField
        label={t('fuelType')} required value={form.fuel_type} onChange={set('fuel_type')}
        options={TRUCK_FUEL_TYPE_OPTIONS} labels={FUEL_LABELS_WITH_OTHER} language={language} t={t} placeholder={t('selectFuelType')}
      />
      {form.fuel_type === 'other' && (
        <Field label={t('specifyFuelType')} value={form.fuel_type_other} onChangeText={set('fuel_type_other')} />
      )}
      <PickerField
        label={t('axleType')} required value={form.axle_type} onChange={set('axle_type')}
        options={TRUCK_AXLE_TYPES} labels={AXLE_LABELS} language={language} t={t} placeholder={t('selectAxleType')}
      />

      <Text className="mb-2 mt-1 text-xs font-semibold uppercase text-slate-400">{t('ownerAndDriver')}</Text>
      <Field label={t('ownerName')} required value={form.owner_name} onChangeText={set('owner_name')} />
      <Field label={t('ownerMobile')} required keyboardType="phone-pad" value={form.owner_mobile} onChangeText={set('owner_mobile')} />
      <Text className="mb-2 -mt-1 text-xs text-slate-400">{t('driverDetailsOptional')}</Text>
      <Field label={t('driverName')} value={form.driver_name} onChangeText={set('driver_name')} />
      <Field label={t('driverMobile')} keyboardType="phone-pad" value={form.driver_mobile} onChangeText={set('driver_mobile')} />

      <Text className="mb-2 mt-1 text-xs font-semibold uppercase text-slate-400">{t('documentExpiryDates')}</Text>
      <DateField label={t('permitExpiry')} value={form.permit_expiry} onChange={set('permit_expiry')} />
      <DateField label={t('pucExpiry')} value={form.puc_expiry} onChange={set('puc_expiry')} />
      <DateField label={t('insuranceExpiry')} value={form.insurance_expiry} onChange={set('insurance_expiry')} />

      {!!error && <Text className="mb-3 text-xs text-red-600">{error}</Text>}

      <ConfirmDetailsCheckbox checked={confirmed} onChange={setConfirmed} t={t} />

      <View className="mt-2 flex-row gap-3">
        <Button mode="outlined" className="flex-1" onPress={onCancel}>{t('cancel')}</Button>
        <Button
          mode="contained"
          buttonColor="#f97316"
          className="flex-1"
          loading={save.isPending}
          disabled={save.isPending || !confirmed}
          onPress={() => {
            setError('');
            const errors = getValidationErrors();
            if (errors.length > 0) return setError(`${t('missingLabel')}: ${errors.join(', ')}`);
            save.mutate();
          }}
        >
          {truckId ? t('save') : t('saveAndContinue')}
        </Button>
      </View>

      <Text className="mb-3 mt-5 text-sm font-semibold text-slate-500">{t('registrationDocs')}</Text>

      {truckId ? (
        <>
          {DOCUMENT_ROWS.map(({ type, expiryField, required }) => {
            const meta = TRUCK_DOCUMENT_META[type];
            const label = meta.labelKey ? t(meta.labelKey) : type;
            return (
              <View key={type}>
                <DocumentUploadRow
                  bucket={TRUCK_BUCKET}
                  documentType={type}
                  label={required ? `${label} *` : label}
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
          {!requiredDocsUploaded && (
            <Text className="mb-3 text-xs text-orange-600">{t('requiredDocsReminder')}</Text>
          )}
          <Button mode="contained" buttonColor="#f97316" disabled={!requiredDocsUploaded} onPress={onSaved}>
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
          {DOCUMENT_ROWS.map(({ type, required }) => {
            const meta = TRUCK_DOCUMENT_META[type];
            const label = meta.labelKey ? t(meta.labelKey) : type;
            return (
              <View key={type} className="mb-3 flex-row items-center rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4 opacity-50">
                <Icon source={meta.icon} size={22} color="#94a3b8" />
                <Text className="ml-3 flex-1 text-sm font-semibold text-slate-500">{required ? `${label} *` : label}</Text>
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
              {truck.truck_type === 'other' ? (truck.truck_type_other || t('other')) : TRUCK_TYPE_LABELS[language]?.[truck.truck_type] ?? truck.truck_type}
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
  const navigation = useNavigation();
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

      {(trucks || []).length > 0 && !formState && (
        <TouchableOpacity
          className="mb-4 flex-row items-center justify-center rounded-2xl bg-brand py-4"
          onPress={() => navigation.navigate('PostTruck')}
        >
          <Icon source="calendar-clock-outline" size={18} color="white" />
          <Text className="ml-2 text-sm font-bold text-white">{t('postTruckAvailability')}</Text>
        </TouchableOpacity>
      )}

      {(trucks || []).map((truck) => (
        <TruckCard key={truck.id} truck={truck} onEdit={openEdit} t={t} language={language} />
      ))}
    </ScrollView>
  );
}
