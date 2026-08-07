import { Alert } from 'react-native';

// Shared "are you sure?" gate in front of every form submission in the app —
// same Cancel/Confirm Alert shape TruckDetailsScreen's "Delete truck" confirm
// already uses, just generalized to "submit" so every form asks the same
// way instead of each screen rolling its own wording. Call it in place of
// firing a mutation directly; onConfirm only runs if the user taps through.
export function confirmSubmit(t, onConfirm, { title, message, confirmLabel } = {}) {
  Alert.alert(
    title || t('confirmSubmitTitle'),
    message || t('confirmSubmitMessage'),
    [
      { text: t('cancel'), style: 'cancel' },
      { text: confirmLabel || t('submit'), onPress: onConfirm }
    ]
  );
}
