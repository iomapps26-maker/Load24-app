import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput, Button, HelperText, Chip, Icon } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import ConfirmDetailsCheckbox from '../components/ConfirmDetailsCheckbox';
import DateField from '../components/DateField';

// "Post Truck Availability" — the reverse of PostLoadScreen: instead of a
// shipper posting a load looking for a truck, a driver/vehicle_owner posts
// one of their already-registered trucks (see TruckDetailsScreen/trucks
// table) as available for loads. Distinct from truck *registration*: one
// registered truck can have many availability postings over time, each
// tracked in its own `truck_availabilities` row (see
// db/migrations/027_add_truck_availabilities.sql) with its own status
// lifecycle (available → offered → held → booked → loading → trip active →
// unavailable/maintenance) — that lifecycle isn't editable from this form,
// it starts every posting at 'available'.
const TRIP_PREFERENCES = ['single_trip', 'return_load', 'regular_lane'];
const TRIP_PREFERENCE_LABELS = { single_trip: 'Single trip', return_load: 'Return load', regular_lane: 'Regular lane' };
const RECURRING_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const RECURRING_DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

const REQUIRED = ['current_pincode', 'current_city', 'current_state'];
const REQUIRED_LABELS = { current_pincode: 'Pincode', current_city: 'City', current_state: 'State' };

function Field({ label, required, ...props }) {
  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm text-slate-600">{label}{required ? ' *' : ''}</Text>
      <TextInput mode="outlined" dense {...props} />
    </View>
  );
}

function TruckPicker({ trucks, isLoading, selectedId, onSelect, navigation }) {
  if (isLoading) {
    return <ActivityIndicator className="my-4" color="#f97316" />;
  }

  if ((trucks || []).length === 0) {
    return (
      <TouchableOpacity
        className="mb-5 flex-row items-center justify-center rounded-2xl border-2 border-dashed border-brand py-4"
        onPress={() => navigation.navigate('TruckDetails')}
      >
        <Icon source="plus" size={18} color="#f97316" />
        <Text className="ml-2 text-sm font-bold text-brand">Register a truck first</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View className="mb-5">
      <Text className="mb-2 text-sm text-slate-600">Which truck is this posting for? *</Text>
      {trucks.map((truck) => (
        <TouchableOpacity
          key={truck.id}
          className={`mb-2 flex-row items-center justify-between rounded-xl border px-4 py-3 ${
            selectedId === truck.id ? 'border-brand bg-orange-50' : 'border-slate-200 bg-white'
          }`}
          onPress={() => onSelect(truck.id)}
        >
          <View className="flex-row items-center">
            <Icon source="truck-outline" size={18} color={selectedId === truck.id ? '#f97316' : '#334155'} />
            <Text className="ml-3 text-sm font-semibold text-slate-800">{truck.registration_number}</Text>
          </View>
          {selectedId === truck.id && <Icon source="check-circle" size={18} color="#f97316" />}
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function PostTruckScreen() {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const { data: trucks, isLoading: trucksLoading } = useQuery({ queryKey: ['trucks'], queryFn: api.trucks.mine });

  const [truckId, setTruckId] = useState(null);
  const [availableNow, setAvailableNow] = useState(true);
  const [form, setForm] = useState({
    available_from: '',
    current_pincode: '', current_city: '', current_state: '',
    preferred_routes: '', destination_preference: '', operating_radius_km: '',
    expected_freight: '', minimum_freight: ''
  });
  const [tripPreference, setTripPreference] = useState('single_trip');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringDays, setRecurringDays] = useState([]);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const toggleRecurringDay = (day) =>
    setRecurringDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));

  const createAvailability = useMutation({
    mutationFn: () =>
      api.truckAvailability.create({
        truck_id: truckId,
        available_now: availableNow,
        available_from: availableNow ? undefined : form.available_from,
        current_pincode: form.current_pincode,
        current_city: form.current_city,
        current_state: form.current_state,
        preferred_routes: form.preferred_routes || undefined,
        destination_preference: form.destination_preference || undefined,
        operating_radius_km: form.operating_radius_km ? Number(form.operating_radius_km) : undefined,
        expected_freight: form.expected_freight ? Number(form.expected_freight) : undefined,
        minimum_freight: form.minimum_freight ? Number(form.minimum_freight) : undefined,
        trip_preference: tripPreference,
        is_recurring: isRecurring,
        recurring_days: isRecurring ? recurringDays : undefined
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['truckAvailability'] });
      navigation.goBack();
    },
    onError: (err) => setError(err.message)
  });

  // Named per-field, same reasoning as PostLoadScreen's getValidationErrors —
  // a flat "fill all required fields" doesn't say which one on a form this
  // long, so list exactly what's missing instead.
  const getValidationErrors = () => {
    const errors = [];
    if (!truckId) errors.push('Which truck this posting is for');
    errors.push(...REQUIRED.filter((k) => !String(form[k]).trim()).map((k) => REQUIRED_LABELS[k]));
    if (!availableNow && !form.available_from.trim()) errors.push('Available from date');
    if (isRecurring && recurringDays.length === 0) errors.push('At least one repeat day');
    return errors;
  };

  const isValid = getValidationErrors().length === 0;

  const handleSubmit = () => {
    setError('');
    const errors = getValidationErrors();
    if (errors.length > 0) return setError(`Missing: ${errors.join(', ')}`);
    createAvailability.mutate();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <TruckPicker
          trucks={trucks}
          isLoading={trucksLoading}
          selectedId={truckId}
          onSelect={setTruckId}
          navigation={navigation}
        />

        <Text className="mb-2 text-sm text-slate-600">Availability *</Text>
        <View className="mb-4 flex-row gap-2">
          <Chip selected={availableNow} onPress={() => setAvailableNow(true)} compact>Available now</Chip>
          <Chip selected={!availableNow} onPress={() => setAvailableNow(false)} compact>Available from date</Chip>
        </View>
        {!availableNow && (
          <DateField label="Available from" required value={form.available_from} onChange={set('available_from')} />
        )}

        <Text className="mb-4 mt-2 text-lg font-bold text-slate-900">Current location</Text>
        <Field label="Pincode" required keyboardType="number-pad" value={form.current_pincode} onChangeText={set('current_pincode')} />
        <View className="flex-row gap-3">
          <View className="flex-1"><Field label="City" required value={form.current_city} onChangeText={set('current_city')} /></View>
          <View className="flex-1"><Field label="State" required value={form.current_state} onChangeText={set('current_state')} /></View>
        </View>
        <Field label="Preferred routes" value={form.preferred_routes} onChangeText={set('preferred_routes')} placeholder="e.g. Delhi - Mumbai, Delhi - Pune" />
        <Field label="Destination preference" value={form.destination_preference} onChangeText={set('destination_preference')} placeholder="e.g. Any, or specific cities" />
        <Field label="Operating radius (km)" keyboardType="number-pad" value={form.operating_radius_km} onChangeText={set('operating_radius_km')} />

        <Text className="mb-4 mt-2 text-lg font-bold text-slate-900">Freight</Text>
        <View className="flex-row gap-3">
          <View className="flex-1"><Field label="Expected freight (₹)" keyboardType="number-pad" value={form.expected_freight} onChangeText={set('expected_freight')} /></View>
          <View className="flex-1"><Field label="Minimum acceptable (₹)" keyboardType="number-pad" value={form.minimum_freight} onChangeText={set('minimum_freight')} /></View>
        </View>

        <Text className="mb-2 text-sm text-slate-600">Trip preference *</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {TRIP_PREFERENCES.map((pref) => (
            <Chip key={pref} selected={tripPreference === pref} onPress={() => setTripPreference(pref)} compact>
              {TRIP_PREFERENCE_LABELS[pref]}
            </Chip>
          ))}
        </View>

        <Text className="mb-2 text-sm text-slate-600">Repeat availability</Text>
        <View className="mb-2 flex-row gap-2">
          <Chip selected={isRecurring} onPress={() => setIsRecurring((v) => !v)} compact icon="repeat">
            Repeat this posting weekly
          </Chip>
        </View>
        {isRecurring && (
          <View className="mb-4 flex-row flex-wrap gap-2">
            {RECURRING_DAYS.map((day) => (
              <Chip key={day} selected={recurringDays.includes(day)} onPress={() => toggleRecurringDay(day)} compact>
                {RECURRING_DAY_LABELS[day]}
              </Chip>
            ))}
          </View>
        )}

        <HelperText type="error" visible={!!error}>{error}</HelperText>

        <ConfirmDetailsCheckbox checked={confirmed} onChange={setConfirmed} t={t} />

        <Button
          mode="contained"
          buttonColor="#f97316"
          loading={createAvailability.isPending}
          disabled={createAvailability.isPending || !confirmed}
          onPress={handleSubmit}
        >
          Post Availability
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
