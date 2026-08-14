import { Modal, View, Text, Image, TouchableOpacity } from 'react-native';
import { Icon } from 'react-native-paper';
import { downloadQr } from '../lib/downloadQr';

// Full-size QR view opened from the small "Show QR" trigger next to a UPI
// ID — the inline thumbnail on the payment cards is too small to scan
// reliably, so this gives a properly sized code plus the same download
// action, without duplicating the download plumbing.
export default function QrCodeModal({ visible, onClose, qrSource, assetPath, filename, title, upiId, t }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/60 px-8">
        <View className="w-full max-w-xs items-center rounded-2xl bg-white p-6">
          <View className="mb-3 w-full flex-row items-center justify-between">
            <Text className="text-base font-bold text-slate-900">{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon source="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>

          <Image source={qrSource} style={{ width: 220, height: 220 }} resizeMode="contain" />

          {!!upiId && <Text className="mt-3 text-sm font-semibold text-brand">{upiId}</Text>}
          <Text className="mt-1 text-xs text-slate-400">{t('scanToPay')}</Text>

          <TouchableOpacity className="mt-4 rounded-full bg-brand px-5 py-2.5" onPress={() => downloadQr(assetPath, filename, t)}>
            <Text className="text-xs font-bold text-white">↓ {t('download')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
