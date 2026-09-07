import { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { TextInput, Button, HelperText, Chip } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { api } from '../lib/api';
import {
  TRUCK_TYPES, TRUCK_TYPE_LABELS, FUEL_TYPES, FUEL_LABELS,
  AXLE_TYPES, AXLE_LABELS, BODY_TYPES, BODY_TYPE_LABELS,
  SPECIAL_CONDITIONS, SPECIAL_CONDITION_LABELS
} from '../lib/loadOptions';
import { useLanguage } from '../lib/i18n';
import { usePincodeAutofill } from '../lib/usePincodeAutofill';
import ConfirmDetailsCheckbox from '../components/ConfirmDetailsCheckbox';
import DateField from '../components/DateField';

const REQUIRED = [
  'loading_pincode', 'loading_address', 'loading_landmark', 'loading_city', 'loading_state',
  'unloading_pincode', 'unloading_address', 'unloading_landmark', 'unloading_city', 'unloading_state',
  'material_type', 'weight_tons', 'bhada_price', 'truck_length_ft',
  'loading_poc_name', 'loading_poc_mobile', 'unloading_poc_name', 'unloading_poc_mobile',
  'loading_date', 'loading_time'
];

// PostLoadScreen is a bottom-tab screen ("Create"), not a stack screen pushed
// on top of another one — it stays mounted for the life of the app session
// (same as every other tab, see HomeScreen's useFocusEffect comment), so its
// useState form never resets on its own between visits. Kept as a constant
// (rather than inlined in useState) so a successful post can reset back to
// exactly this instead of stale field values reappearing next time the
// poster opens this tab.
const INITIAL_FORM = {
  loading_pincode: '', loading_address: '', loading_landmark: '', loading_city: '', loading_state: '',
  unloading_pincode: '', unloading_address: '', unloading_landmark: '', unloading_city: '', unloading_state: '',
  material_type: '', weight_tons: '', bhada_price: '', truck_length_ft: '',
  loading_poc_name: '', loading_poc_mobile: '', unloading_poc_name: '', unloading_poc_mobile: '',
  loading_date: '', loading_time: '', unloading_date: '', special_demand_comment: '', custom_requirement: '',
  required_truck_type_other: '', fuel_type_required_other: '', axle_type_other: '', body_type_other: ''
};

function Field({ label, value, onChangeText, required, ...props }) {
  return (
    <View className="mb-4">
      <Text className="mb-1 text-sm text-slate-600">{label}{required ? ' *' : ''}</Text>
      <TextInput mode="outlined" value={value} onChangeText={onChangeText} dense {...props} />
    </View>
  );
}

export default function PostLoadScreen() {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { language, t } = useLanguage();
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: api.profile.me });

  const [form, setForm] = useState(INITIAL_FORM);
  const [truckType, setTruckType] = useState('tata_407');
  const [fuelType, setFuelType] = useState('any');
  const [axleType, setAxleType] = useState('any');
  const [bodyType, setBodyType] = useState('any');
  const [specialConditions, setSpecialConditions] = useState([]);
  const [otherConditionSelected, setOtherConditionSelected] = useState(false);
  const [otherConditionText, setOtherConditionText] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  // Human-readable name for each REQUIRED key, so a failed submit can name
  // exactly what's missing instead of a blanket "fill all required fields" —
  // on a form this long (six sections, most of them off-screen at once) that
  // generic message leaves no way to tell which field is the problem. Built
  // from t() so the error reads in the poster's chosen language.
  const requiredLabels = {
    loading_pincode: `${t('loading')} ${t('pincode')}`,
    loading_address: `${t('loading')} ${t('address')}`,
    loading_landmark: `${t('loading')} ${t('landmark')}`,
    loading_city: `${t('loading')} ${t('city')}`,
    loading_state: `${t('loading')} ${t('state')}`,
    unloading_pincode: `${t('unloading')} ${t('pincode')}`,
    unloading_address: `${t('unloading')} ${t('address')}`,
    unloading_landmark: `${t('unloading')} ${t('landmark')}`,
    unloading_city: `${t('unloading')} ${t('city')}`,
    unloading_state: `${t('unloading')} ${t('state')}`,
    material_type: t('materialType'),
    weight_tons: t('weightTons'),
    bhada_price: t('bhadaPrice'),
    truck_length_ft: t('truckLengthFt'),
    loading_poc_name: `${t('loading')} ${t('contactName')}`,
    loading_poc_mobile: `${t('loading')} ${t('contactMobile')}`,
    unloading_poc_name: `${t('unloading')} ${t('contactName')}`,
    unloading_poc_mobile: `${t('unloading')} ${t('contactMobile')}`,
    loading_date: t('loadingDate'),
    loading_time: t('loadingTime')
  };

  // Same auto-fill as account creation — a valid pincode fills in its city
  // and state instead of making the poster type them by hand.
  const loadingPincodeLoading = usePincodeAutofill(form.loading_pincode, (city, state) => {
    setForm((f) => ({ ...f, loading_city: city, loading_state: state }));
  });
  const unloadingPincodeLoading = usePincodeAutofill(form.unloading_pincode, (city, state) => {
    setForm((f) => ({ ...f, unloading_city: city, unloading_state: state }));
  });

  const toggleSpecialCondition = (condition) =>
    setSpecialConditions((prev) => (prev.includes(condition) ? prev.filter((c) => c !== condition) : [...prev, condition]));

  const posterType = ['shipper', 'transporter', 'broker'].includes(profile?.user_type) ? profile.user_type : 'shipper';

  const createLoad = useMutation({
    mutationFn: () =>
      api.loads.create({
        ...form,
        weight_tons: Number(form.weight_tons),
        bhada_price: Number(form.bhada_price),
        truck_length_ft: Number(form.truck_length_ft),
        required_truck_type: truckType,
        required_truck_type_other: truckType === 'other' ? form.required_truck_type_other.trim() : undefined,
        fuel_type_required: fuelType,
        fuel_type_required_other: fuelType === 'other' ? form.fuel_type_required_other.trim() : undefined,
        axle_type: axleType,
        axle_type_other: axleType === 'other' ? form.axle_type_other.trim() : undefined,
        body_type: bodyType,
        body_type_other: bodyType === 'other' ? form.body_type_other.trim() : undefined,
        special_conditions:
          otherConditionSelected && otherConditionText.trim()
            ? [...specialConditions, otherConditionText.trim()]
            : specialConditions,
        poster_type: posterType,
        company_name: profile?.company_name || undefined
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myLoads'] });
      queryClient.invalidateQueries({ queryKey: ['loads'] });
      queryClient.invalidateQueries({ queryKey: ['recentLoads'] });
      // Clear the form back to blank now that it's posted — this tab stays
      // mounted (see INITIAL_FORM above), so without this the next visit
      // would silently reopen with the just-submitted load's details still
      // sitting in every field.
      setForm(INITIAL_FORM);
      setTruckType('tata_407');
      setFuelType('any');
      setAxleType('any');
      setBodyType('any');
      setSpecialConditions([]);
      setOtherConditionSelected(false);
      setOtherConditionText('');
      setConfirmed(false);
      // goBack() lands on whichever tab was focused before "Create" (usually
      // Home, since bottom tabs remember tab-switch history) — jump to Find
      // Loads instead so the poster sees their new load live in the
      // marketplace right away.
      navigation.navigate('Loads');
    },
    onError: (err) => setError(err.message)
  });

  // Every reason handleSubmit could reject, named — rather than just a
  // boolean, so the error message can say exactly what's wrong instead of
  // a blanket "fill all required fields".
  const getValidationErrors = () => {
    const errors = REQUIRED.filter((k) => !String(form[k]).trim()).map((k) => requiredLabels[k]);
    if (form.weight_tons.trim() && isNaN(Number(form.weight_tons))) errors.push(`${t('weightTons')} ${t('mustBeNumber')}`);
    if (form.bhada_price.trim() && isNaN(Number(form.bhada_price))) errors.push(`${t('bhadaPrice')} ${t('mustBeNumber')}`);
    if (form.truck_length_ft.trim() && isNaN(Number(form.truck_length_ft))) errors.push(`${t('truckLengthFt')} ${t('mustBeNumber')}`);
    if (truckType === 'other' && !form.required_truck_type_other.trim()) errors.push(t('specifyTruckType'));
    if (fuelType === 'other' && !form.fuel_type_required_other.trim()) errors.push(t('specifyFuelType'));
    if (axleType === 'other' && !form.axle_type_other.trim()) errors.push(t('specifyAxleType'));
    if (bodyType === 'other' && !form.body_type_other.trim()) errors.push(t('specifyBodyType'));
    if (otherConditionSelected && !otherConditionText.trim()) errors.push(t('specifySpecialCondition'));
    return errors;
  };

  const isValid = getValidationErrors().length === 0;

  const handleSubmit = () => {
    setError('');
    const errors = getValidationErrors();
    if (errors.length > 0) return setError(`${t('missingOrInvalid')}: ${errors.join(', ')}`);
    createLoad.mutate();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text className="mb-4 text-lg font-bold text-slate-900">{t('loadingPoint')}</Text>
        <Field
          label={t('pincode')} required keyboardType="number-pad" maxLength={6}
          value={form.loading_pincode} onChangeText={set('loading_pincode')}
          right={loadingPincodeLoading ? <TextInput.Icon icon={() => <ActivityIndicator size={16} color="#f97316" />} /> : undefined}
        />
        <Field label={t('address')} required value={form.loading_address} onChangeText={set('loading_address')} />
        <Field label={t('landmark')} required value={form.loading_landmark} onChangeText={set('loading_landmark')} placeholder={t('phLandmark')} />
        <View className="flex-row gap-3">
          <View className="flex-1"><Field label={t('city')} required value={form.loading_city} onChangeText={set('loading_city')} /></View>
          <View className="flex-1"><Field label={t('state')} required value={form.loading_state} onChangeText={set('loading_state')} /></View>
        </View>
        <Field label={t('contactName')} required value={form.loading_poc_name} onChangeText={set('loading_poc_name')} />
        <Field label={t('contactMobile')} required keyboardType="phone-pad" value={form.loading_poc_mobile} onChangeText={set('loading_poc_mobile')} />
        <View className="flex-row gap-3">
          <View className="flex-1"><DateField label={t('loadingDate')} required value={form.loading_date} onChange={set('loading_date')} /></View>
          <View className="flex-1"><Field label={t('loadingTime')} required placeholder={t('phLoadingTime')} value={form.loading_time} onChangeText={set('loading_time')} /></View>
        </View>

        <Text className="mb-4 mt-2 text-lg font-bold text-slate-900">{t('unloadingPoint')}</Text>
        <Field
          label={t('pincode')} required keyboardType="number-pad" maxLength={6}
          value={form.unloading_pincode} onChangeText={set('unloading_pincode')}
          right={unloadingPincodeLoading ? <TextInput.Icon icon={() => <ActivityIndicator size={16} color="#f97316" />} /> : undefined}
        />
        <Field label={t('address')} required value={form.unloading_address} onChangeText={set('unloading_address')} />
        <Field label={t('landmark')} required value={form.unloading_landmark} onChangeText={set('unloading_landmark')} placeholder={t('phLandmark')} />
        <View className="flex-row gap-3">
          <View className="flex-1"><Field label={t('city')} required value={form.unloading_city} onChangeText={set('unloading_city')} /></View>
          <View className="flex-1"><Field label={t('state')} required value={form.unloading_state} onChangeText={set('unloading_state')} /></View>
        </View>
        <Field label={t('contactName')} required value={form.unloading_poc_name} onChangeText={set('unloading_poc_name')} />
        <Field label={t('contactMobile')} required keyboardType="phone-pad" value={form.unloading_poc_mobile} onChangeText={set('unloading_poc_mobile')} />
        <DateField label={t('unloadingDate')} value={form.unloading_date} onChange={set('unloading_date')} />

        <Text className="mb-4 mt-2 text-lg font-bold text-slate-900">{t('loadDetails')}</Text>
        <Field label={t('materialType')} required value={form.material_type} onChangeText={set('material_type')} placeholder={t('phMaterialType')} />
        <View className="flex-row gap-3">
          <View className="flex-1"><Field label={t('weightTons')} required keyboardType="decimal-pad" value={form.weight_tons} onChangeText={set('weight_tons')} /></View>
          <View className="flex-1"><Field label={t('bhadaPrice')} required keyboardType="number-pad" value={form.bhada_price} onChangeText={set('bhada_price')} /></View>
        </View>
        <Field label={t('truckLengthFt')} required keyboardType="decimal-pad" value={form.truck_length_ft} onChangeText={set('truck_length_ft')} />

        <Text className="mb-2 text-sm text-slate-600">{t('requiredTruckType')} *</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {TRUCK_TYPES.map((type) => (
            <Chip key={type} selected={truckType === type} onPress={() => setTruckType(type)} compact>
              {TRUCK_TYPE_LABELS[language]?.[type] ?? type.replace(/_/g, ' ')}
            </Chip>
          ))}
        </View>
        {truckType === 'other' && (
          <Field
            label={t('specifyTruckType')}
            required
            placeholder={t('phSpecifyTruckType')}
            value={form.required_truck_type_other}
            onChangeText={set('required_truck_type_other')}
          />
        )}

        <Text className="mb-2 text-sm text-slate-600">{t('fuelTypeRequired')} *</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {FUEL_TYPES.map((type) => (
            <Chip key={type} selected={fuelType === type} onPress={() => setFuelType(type)} compact>
              {FUEL_LABELS[language]?.[type] ?? type}
            </Chip>
          ))}
        </View>
        {fuelType === 'other' && (
          <Field
            label={t('specifyFuelType')}
            required
            placeholder={t('phSpecifyFuelType')}
            value={form.fuel_type_required_other}
            onChangeText={set('fuel_type_required_other')}
          />
        )}

        <Text className="mb-2 text-sm text-slate-600">{t('axleType')} *</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {AXLE_TYPES.map((type) => (
            <Chip key={type} selected={axleType === type} onPress={() => setAxleType(type)} compact>
              {AXLE_LABELS[language]?.[type] ?? type}
            </Chip>
          ))}
        </View>
        {axleType === 'other' && (
          <Field
            label={t('specifyAxleType')}
            required
            placeholder={t('phSpecifyAxleType')}
            value={form.axle_type_other}
            onChangeText={set('axle_type_other')}
          />
        )}

        <Text className="mb-2 text-sm text-slate-600">{t('bodyType')} *</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {BODY_TYPES.map((type) => (
            <Chip key={type} selected={bodyType === type} onPress={() => setBodyType(type)} compact>
              {BODY_TYPE_LABELS[language]?.[type] ?? type}
            </Chip>
          ))}
        </View>
        {bodyType === 'other' && (
          <Field
            label={t('specifyBodyType')}
            required
            placeholder={t('phSpecifyBodyType')}
            value={form.body_type_other}
            onChangeText={set('body_type_other')}
          />
        )}

        <Text className="mb-2 text-sm text-slate-600">{t('specialConditions')}</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {SPECIAL_CONDITIONS.map((condition) => (
            <Chip key={condition} selected={specialConditions.includes(condition)} onPress={() => toggleSpecialCondition(condition)} compact>
              {SPECIAL_CONDITION_LABELS[language]?.[condition] ?? condition}
            </Chip>
          ))}
          <Chip selected={otherConditionSelected} onPress={() => setOtherConditionSelected((v) => !v)} compact>
            {t('other')}
          </Chip>
        </View>
        {otherConditionSelected && (
          <Field
            label={t('specifySpecialCondition')}
            required
            placeholder={t('phSpecifySpecialCondition')}
            value={otherConditionText}
            onChangeText={setOtherConditionText}
          />
        )}

        <Field label={t('specialDemandComment')} value={form.special_demand_comment} onChangeText={set('special_demand_comment')} placeholder={t('phSpecialDemandComment')} />
        <Field label={t('customRequirement')} value={form.custom_requirement} onChangeText={set('custom_requirement')} placeholder={t('phCustomRequirement')} />

        <HelperText type="error" visible={!!error}>{error}</HelperText>

        <ConfirmDetailsCheckbox checked={confirmed} onChange={setConfirmed} t={t} />

        <Button
          mode="contained"
          buttonColor="#f97316"
          loading={createLoad.isPending}
          disabled={createLoad.isPending || !confirmed}
          onPress={handleSubmit}
        >
          {t('postLoad')}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
