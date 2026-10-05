import { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { TextInput } from 'react-native-paper';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

// A time field that opens the native clock picker on tap instead of
// free-typing "14:00" — same platform branch as DateField.jsx, and stores
// the same 24h "HH:MM" shape the backend's loading-reminder sweep
// (lib/loadingReminders.js) parses to compute the exact loading instant.
export default function TimeField({ label, required, value, onChange }) {
  const [iosPickerVisible, setIosPickerVisible] = useState(false);
  const timeValue = (() => {
    const d = new Date();
    if (value && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
      const [h, m] = value.split(':');
      d.setHours(Number(h), Number(m), 0, 0);
    }
    return d;
  })();

  const handlePicked = (event, selected) => {
    setIosPickerVisible(false);
    if (event.type === 'set' && selected) {
      const hh = String(selected.getHours()).padStart(2, '0');
      const mm = String(selected.getMinutes()).padStart(2, '0');
      onChange(`${hh}:${mm}`);
    }
  };

  const openPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: timeValue, mode: 'time', is24Hour: true, onChange: handlePicked });
    } else {
      setIosPickerVisible(true);
    }
  };

  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm text-slate-600">{label}{required ? ' *' : ''}</Text>
      <TouchableOpacity onPress={openPicker} activeOpacity={0.7}>
        <View pointerEvents="none">
          <TextInput
            mode="outlined"
            dense
            editable={false}
            value={value || ''}
            placeholder="HH:MM"
            right={<TextInput.Icon icon="clock-outline" />}
          />
        </View>
      </TouchableOpacity>
      {Platform.OS === 'ios' && iosPickerVisible && (
        <DateTimePicker mode="time" value={timeValue} is24Hour display="spinner" onChange={handlePicked} />
      )}
    </View>
  );
}
