import { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
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

const REQUIRED = [
  'loading_pincode', 'loading_address', 'loading_landmark', 'loading_city', 'loading_state',
  'unloading_pincode', 'unloading_address', 'unloading_landmark', 'unloading_city', 'unloading_state',
  'material_type', 'weight_tons', 'bhada_price', 'truck_length_ft',
  'loading_poc_name', 'loading_poc_mobile', 'unloading_poc_name', 'unloading_poc_mobile',
  'loading_date', 'loading_time'
];

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
  const { language } = useLanguage();
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: api.profile.me });

  const [form, setForm] = useState({
    loading_pincode: '', loading_address: '', loading_landmark: '', loading_city: '', loading_state: '',
    unloading_pincode: '', unloading_address: '', unloading_landmark: '', unloading_city: '', unloading_state: '',
    material_type: '', weight_tons: '', bhada_price: '', truck_length_ft: '',
    loading_poc_name: '', loading_poc_mobile: '', unloading_poc_name: '', unloading_poc_mobile: '',
    loading_date: '', loading_time: '', special_demand_comment: '', custom_requirement: ''
  });
  const [truckType, setTruckType] = useState('tata_407');
  const [fuelType, setFuelType] = useState('any');
  const [axleType, setAxleType] = useState('any');
  const [bodyType, setBodyType] = useState('any');
  const [specialConditions, setSpecialConditions] = useState([]);
  const [error, setError] = useState('');

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

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
        fuel_type_required: fuelType,
        axle_type: axleType,
        body_type: bodyType,
        special_conditions: specialConditions,
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

  const isValid =
    REQUIRED.every((k) => String(form[k]).trim().length > 0) &&
    !isNaN(Number(form.weight_tons)) &&
    !isNaN(Number(form.bhada_price)) &&
    !isNaN(Number(form.truck_length_ft));

  const handleSubmit = () => {
    setError('');
    if (!isValid) return setError('Please fill all required fields');
    createLoad.mutate();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text className="mb-4 text-lg font-bold text-slate-900">Loading point</Text>
        <Field label="Pincode" required keyboardType="number-pad" value={form.loading_pincode} onChangeText={set('loading_pincode')} />
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
        <Field label="Pincode" required keyboardType="number-pad" value={form.unloading_pincode} onChangeText={set('unloading_pincode')} />
        <Field label="Address" required value={form.unloading_address} onChangeText={set('unloading_address')} />
        <Field label="Landmark" required value={form.unloading_landmark} onChangeText={set('unloading_landmark')} placeholder="e.g. Near XYZ warehouse" />
        <View className="flex-row gap-3">
          <View className="flex-1"><Field label="City" required value={form.unloading_city} onChangeText={set('unloading_city')} /></View>
          <View className="flex-1"><Field label="State" required value={form.unloading_state} onChangeText={set('unloading_state')} /></View>
        </View>
        <Field label="Contact name" required value={form.unloading_poc_name} onChangeText={set('unloading_poc_name')} />
        <Field label="Contact mobile" required keyboardType="phone-pad" value={form.unloading_poc_mobile} onChangeText={set('unloading_poc_mobile')} />

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

        <Text className="mb-2 text-sm text-slate-600">Fuel type required *</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {FUEL_TYPES.map((type) => (
            <Chip key={type} selected={fuelType === type} onPress={() => setFuelType(type)} compact>
              {FUEL_LABELS[language]?.[type] ?? type}
            </Chip>
          ))}
        </View>

        <Text className="mb-2 text-sm text-slate-600">Axle type *</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {AXLE_TYPES.map((type) => (
            <Chip key={type} selected={axleType === type} onPress={() => setAxleType(type)} compact>
              {AXLE_LABELS[language]?.[type] ?? type}
            </Chip>
          ))}
        </View>

        <Text className="mb-2 text-sm text-slate-600">Body type *</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {BODY_TYPES.map((type) => (
            <Chip key={type} selected={bodyType === type} onPress={() => setBodyType(type)} compact>
              {BODY_TYPE_LABELS[language]?.[type] ?? type}
            </Chip>
          ))}
        </View>

        <Text className="mb-2 text-sm text-slate-600">Special conditions</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {SPECIAL_CONDITIONS.map((condition) => (
            <Chip key={condition} selected={specialConditions.includes(condition)} onPress={() => toggleSpecialCondition(condition)} compact>
              {SPECIAL_CONDITION_LABELS[language]?.[condition] ?? condition}
            </Chip>
          ))}
        </View>

        <Field label="Special demand comment" value={form.special_demand_comment} onChangeText={set('special_demand_comment')} placeholder="Any additional handling instructions" />
        <Field label="Custom requirement" value={form.custom_requirement} onChangeText={set('custom_requirement')} placeholder="Anything else the transporter should know" />

        <HelperText type="error" visible={!!error}>{error}</HelperText>

        <Button
          mode="contained"
          buttonColor="#f97316"
          loading={createLoad.isPending}
          disabled={createLoad.isPending}
          onPress={handleSubmit}
        >
          Post Load
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
