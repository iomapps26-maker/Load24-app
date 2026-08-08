import { View, Text } from 'react-native';
import { Checkbox } from 'react-native-paper';

// Inline replacement for the old confirmSubmit() Alert popup — same "make
// the user actively confirm before this goes anywhere" guarantee, but as
// part of the form itself (sitting just above the submit button) instead of
// interrupting with a modal. The submit button's `disabled` should include
// `!checked` so this is a real gate, not just a decoration.
export default function ConfirmDetailsCheckbox({ checked, onChange, t }) {
  return (
    <View className="mb-3 flex-row items-center rounded-xl border border-slate-200 bg-slate-50 px-2 py-1">
      <Checkbox status={checked ? 'checked' : 'unchecked'} onPress={() => onChange(!checked)} color="#f97316" />
      <Text className="flex-1 text-sm text-slate-700">{t('confirmDetailsCheckbox')}</Text>
    </View>
  );
}
