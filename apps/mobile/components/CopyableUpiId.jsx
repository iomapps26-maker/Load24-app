import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Icon } from 'react-native-paper';
import Clipboard from '@react-native-clipboard/clipboard';

// UPI ID with a tap-to-copy icon right next to it — swaps to a checkmark
// for a beat so the tap has visible feedback, since there's no OS-level
// "copied" toast on all Android versions the way there is on 13+.
export default function CopyableUpiId({ upiId }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    Clipboard.setString(upiId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View className="mb-2 flex-row items-center">
      <Text className="text-sm font-semibold text-brand">{upiId}</Text>
      <TouchableOpacity className="ml-2 p-1" onPress={handleCopy} hitSlop={8}>
        <Icon source={copied ? 'check' : 'content-copy'} size={14} color={copied ? '#16a34a' : '#f97316'} />
      </TouchableOpacity>
    </View>
  );
}
