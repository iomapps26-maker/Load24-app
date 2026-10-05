import { View, Text } from 'react-native';
import { Icon } from 'react-native-paper';

// Small "by Support Team" pill for anything a LOAD24 support executive
// created or changed on this user's behalf over the phone (the backend's
// Executive Desk stamps support_staff_id on the row — see
// apps/backend/src/routes/executive.js). Renders nothing otherwise.
export default function SupportTeamTag({ record, t, className = '' }) {
  if (!record?.support_staff_id) return null;
  return (
    <View className={`flex-row items-center self-start rounded-full bg-blue-50 px-2 py-0.5 ${className}`}>
      <Icon source="headset" size={12} color="#1d4ed8" />
      <Text className="ml-1 text-[11px] font-semibold text-blue-700">{t('bySupportTeam')}</Text>
    </View>
  );
}
