import { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { TextInput } from 'react-native-paper';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

// A date field that opens the native calendar picker on tap instead of
// free-typing "YYYY-MM-DD" — Android exposes this as an imperative dialog
// API, iOS as a mounted picker component, hence the platform branch.
export default function DateField({ label, required, value, onChange, minimumDate }) {
  const [iosPickerVisible, setIosPickerVisible] = useState(false);
  const dateValue = value ? new Date(value) : new Date();

  const handlePicked = (event, selected) => {
    setIosPickerVisible(false);
    if (event.type === 'set' && selected) onChange(selected.toISOString().slice(0, 10));
  };

  const openPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: dateValue, mode: 'date', minimumDate, onChange: handlePicked });
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
            placeholder="YYYY-MM-DD"
            right={<TextInput.Icon icon="calendar" />}
          />
        </View>
      </TouchableOpacity>
      {Platform.OS === 'ios' && iosPickerVisible && (
        <DateTimePicker mode="date" value={dateValue} minimumDate={minimumDate} display="spinner" onChange={handlePicked} />
      )}
    </View>
  );
}
