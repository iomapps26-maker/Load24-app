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

const REQUIRED = [
  'loading_pincode', 'loading_address', 'loading_landmark', 'loading_city', 'loading_state',
  'unloading_pincode', 'unloading_address', 'unloading_landmark', 'unloading_city', 'unloading_state',
  'material_type', 'weight_tons', 'bhada_price', 'truck_length_ft',
  'loading_poc_name', 'loading_poc_mobile', 'unloading_poc_name', 'unloading_poc_mobile',
  'loading_date', 'loading_time'
];

// Human-readable name for each REQUIRED key, so a failed submit can name
// exactly what's missing instead of a blanket "fill all required fields" —
// on a form this long (six sections, most of them off-screen at once) that
// generic message leaves no way to tell which field is the problem.
const REQUIRED_LABELS = {
  loading_pincode: 'Loading pincode', loading_address: 'Loading address', loading_landmark: 'Loading landmark',
  loading_city: 'Loading city', loading_state: 'Loading state',
  unloading_pincode: 'Unloading pincode', unloading_address: 'Unloading address', unloading_landmark: 'Unloading landmark',
  unloading_city: 'Unloading city', unloading_state: 'Unloading state',
  material_type: 'Material type', weight_tons: 'Weight (tons)', bhada_price: 'Bhada price (₹)', truck_length_ft: 'Truck length (ft)',
  loading_poc_name: 'Loading contact name', loading_poc_mobile: 'Loading contact mobile',
  unloading_poc_name: 'Unloading contact name', unloading_poc_mobile: 'Unloading contact mobile',
  loading_date: 'Loading date', loading_time: 'Loading time'
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

  const [form, setForm] = useState({
    loading_pincode: '', loading_address: '', loading_landmark: '', loading_city: '', loading_state: '',
    unloading_pincode: '', unloading_address: '', unloading_landmark: '', unloading_city: '', unloading_state: '',
    material_type: '', weight_tons: '', bhada_price: '', truck_length_ft: '',
    loading_poc_name: '', loading_poc_mobile: '', unloading_poc_name: '', unloading_poc_mobile: '',
    loading_date: '', loading_time: '', unloading_date: '', special_demand_comment: '', custom_requirement: '',
    required_truck_type_other: '', fuel_type_required_other: '', axle_type_other: '', body_type_other: ''
  });
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
      navigation.goBack();
    },
    onError: (err) => setError(err.message)
  });

  // Every reason handleSubmit could reject, named — rather than just a
  // boolean, so the error message can say exactly what's wrong instead of
  // a blanket "fill all required fields".
  const getValidationErrors = () => {
    const errors = REQUIRED.filter((k) => !String(form[k]).trim()).map((k) => REQUIRED_LABELS[k]);
    if (form.weight_tons.trim() && isNaN(Number(form.weight_tons))) errors.push('Weight (tons) must be a number');
    if (form.bhada_price.trim() && isNaN(Number(form.bhada_price))) errors.push('Bhada price (₹) must be a number');
    if (form.truck_length_ft.trim() && isNaN(Number(form.truck_length_ft))) errors.push('Truck length (ft) must be a number');
    if (truckType === 'other' && !form.required_truck_type_other.trim()) errors.push('Specify truck type');
    if (fuelType === 'other' && !form.fuel_type_required_other.trim()) errors.push('Specify fuel type');
    if (axleType === 'other' && !form.axle_type_other.trim()) errors.push('Specify axle type');
    if (bodyType === 'other' && !form.body_type_other.trim()) errors.push('Specify body type');
    if (otherConditionSelected && !otherConditionText.trim()) errors.push('Specify special condition');
    return errors;
  };

  const isValid = getValidationErrors().length === 0;

  const handleSubmit = () => {
    setError('');
    const errors = getValidationErrors();
    if (errors.length > 0) return setError(`Missing or invalid: ${errors.join(', ')}`);
    createLoad.mutate();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text className="mb-4 text-lg font-bold text-slate-900">Loading point</Text>
        <Field
          label="Pincode" required keyboardType="number-pad" maxLength={6}
          value={form.loading_pincode} onChangeText={set('loading_pincode')}
          right={loadingPincodeLoading ? <TextInput.Icon icon={() => <ActivityIndicator size={16} color="#f97316" />} /> : undefined}
        />
        <Field label="Address" required value={form.loading_address} onChangeText={set('loading_address')} />
        <Field label="Landmark" required value={form.loading_landmark} onChangeText={set('loading_landmark')} placeholder="e.g. Near XYZ warehouse" />
        <View className="flex-row gap-3">
          <View className="flex-1"><Field label="City" required value={form.loading_city} onChangeText={set('loading_city')} /></View>
          <View className="flex-1"><Field label="State" required value={form.loading_state} onChangeText={set('loading_state')} /></View>
        </View>
        <Field label="Contact name" required value={form.loading_poc_name} onChangeText={set('loading_poc_name')} />
        <Field label="Contact mobile" required keyboardType="phone-pad" value={form.loading_poc_mobile} onChangeText={set('loading_poc_mobile')} />
        <View className="flex-row gap-3">
          <View className="flex-1"><Field label="Loading date" required placeholder="YYYY-MM-DD" value={form.loading_date} onChangeText={set('loading_date')} /></View>
          <View className="flex-1"><Field label="Loading time" required placeholder="e.g. 14:00" value={form.loading_time} onChangeText={set('loading_time')} /></View>
        </View>

        <Text className="mb-4 mt-2 text-lg font-bold text-slate-900">Unloading point</Text>
        <Field
          label="Pincode" required keyboardType="number-pad" maxLength={6}
          value={form.unloading_pincode} onChangeText={set('unloading_pincode')}
          right={unloadingPincodeLoading ? <TextInput.Icon icon={() => <ActivityIndicator size={16} color="#f97316" />} /> : undefined}
        />
        <Field label="Address" required value={form.unloading_address} onChangeText={set('unloading_address')} />
        <Field label="Landmark" required value={form.unloading_landmark} onChangeText={set('unloading_landmark')} placeholder="e.g. Near XYZ warehouse" />
        <View className="flex-row gap-3">
          <View className="flex-1"><Field label="City" required value={form.unloading_city} onChangeText={set('unloading_city')} /></View>
          <View className="flex-1"><Field label="State" required value={form.unloading_state} onChangeText={set('unloading_state')} /></View>
        </View>
        <Field label="Contact name" required value={form.unloading_poc_name} onChangeText={set('unloading_poc_name')} />
        <Field label="Contact mobile" required keyboardType="phone-pad" value={form.unloading_poc_mobile} onChangeText={set('unloading_poc_mobile')} />
        <Field label="Unloading date" placeholder="YYYY-MM-DD" value={form.unloading_date} onChangeText={set('unloading_date')} />

        <Text className="mb-4 mt-2 text-lg font-bold text-slate-900">Load details</Text>
        <Field label="Material type" required value={form.material_type} onChangeText={set('material_type')} placeholder="e.g. Cement, Steel, Cotton" />
        <View className="flex-row gap-3">
          <View className="flex-1"><Field label="Weight (tons)" required keyboardType="decimal-pad" value={form.weight_tons} onChangeText={set('weight_tons')} /></View>
          <View className="flex-1"><Field label="Bhada price (₹)" required keyboardType="number-pad" value={form.bhada_price} onChangeText={set('bhada_price')} /></View>
        </View>
        <Field label="Truck length (ft)" required keyboardType="decimal-pad" value={form.truck_length_ft} onChangeText={set('truck_length_ft')} />

        <Text className="mb-2 text-sm text-slate-600">Required truck type *</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {TRUCK_TYPES.map((type) => (
            <Chip key={type} selected={truckType === type} onPress={() => setTruckType(type)} compact>
              {TRUCK_TYPE_LABELS[language]?.[type] ?? type.replace(/_/g, ' ')}
            </Chip>
          ))}
        </View>
        {truckType === 'other' && (
          <Field
            label="Specify truck type"
            required
            placeholder="e.g. Bolero Pickup"
            value={form.required_truck_type_other}
            onChangeText={set('required_truck_type_other')}
          />
        )}

        <Text className="mb-2 text-sm text-slate-600">Fuel type required *</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {FUEL_TYPES.map((type) => (
            <Chip key={type} selected={fuelType === type} onPress={() => setFuelType(type)} compact>
              {FUEL_LABELS[language]?.[type] ?? type}
            </Chip>
          ))}
        </View>
        {fuelType === 'other' && (
          <Field
            label="Specify fuel type"
            required
            placeholder="e.g. Petrol"
            value={form.fuel_type_required_other}
            onChangeText={set('fuel_type_required_other')}
          />
        )}

        <Text className="mb-2 text-sm text-slate-600">Axle type *</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {AXLE_TYPES.map((type) => (
            <Chip key={type} selected={axleType === type} onPress={() => setAxleType(type)} compact>
              {AXLE_LABELS[language]?.[type] ?? type}
            </Chip>
          ))}
        </View>
        {axleType === 'other' && (
          <Field
            label="Specify axle type"
            required
            placeholder="e.g. Triple Axle"
            value={form.axle_type_other}
            onChangeText={set('axle_type_other')}
          />
        )}

        <Text className="mb-2 text-sm text-slate-600">Body type *</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {BODY_TYPES.map((type) => (
            <Chip key={type} selected={bodyType === type} onPress={() => setBodyType(type)} compact>
              {BODY_TYPE_LABELS[language]?.[type] ?? type}
            </Chip>
          ))}
        </View>
        {bodyType === 'other' && (
          <Field
            label="Specify body type"
            required
            placeholder="e.g. Curtain-sided"
            value={form.body_type_other}
            onChangeText={set('body_type_other')}
          />
        )}

        <Text className="mb-2 text-sm text-slate-600">Special conditions</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {SPECIAL_CONDITIONS.map((condition) => (
            <Chip key={condition} selected={specialConditions.includes(condition)} onPress={() => toggleSpecialCondition(condition)} compact>
              {SPECIAL_CONDITION_LABELS[language]?.[condition] ?? condition}
            </Chip>
          ))}
          <Chip selected={otherConditionSelected} onPress={() => setOtherConditionSelected((v) => !v)} compact>
            {language === 'hi' ? 'अन्य' : 'Other'}
          </Chip>
        </View>
        {otherConditionSelected && (
          <Field
            label="Specify special condition"
            required
            placeholder="e.g. Live animals"
            value={otherConditionText}
            onChangeText={setOtherConditionText}
          />
        )}

        <Field label="Special demand comment" value={form.special_demand_comment} onChangeText={set('special_demand_comment')} placeholder="Any additional handling instructions" />
        <Field label="Custom requirement" value={form.custom_requirement} onChangeText={set('custom_requirement')} placeholder="Anything else the transporter should know" />

        <HelperText type="error" visible={!!error}>{error}</HelperText>

        <ConfirmDetailsCheckbox checked={confirmed} onChange={setConfirmed} t={t} />

        <Button
          mode="contained"
          buttonColor="#f97316"
          loading={createLoad.isPending}
          disabled={createLoad.isPending || !confirmed}
          onPress={handleSubmit}
        >
          Post Load
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
