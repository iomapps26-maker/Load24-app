import { useState } from 'react';
import { View, Text, Modal } from 'react-native';
import { TextInput, Button } from 'react-native-paper';
import { useLanguage } from '../lib/i18n';

// Quick-pick amounts around the load's own asking price (bhada_price), plus a
// free-text field so a bidder can adjust to whatever they actually want to offer.
function presetAmounts(bhadaPrice) {
  const base = Number(bhadaPrice) || 0;
  if (!base) return [];
  const round = (n) => Math.round(n / 100) * 100;
  return [...new Set([round(base * 0.9), base, round(base * 1.1)])].filter((n) => n > 0);
}

export default function BidModal({ visible, load, onClose, onSubmit, loading, error }) {
  const [amount, setAmount] = useState('');
  const { t } = useLanguage();

  const handleClose = () => {
    setAmount('');
    onClose();
  };

  const presets = load ? presetAmounts(load.bhada_price) : [];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-3xl bg-white p-5 pb-8">
          <Text className="mb-1 text-center text-base font-bold text-slate-900">{t('placeBid')}</Text>
          {!!load && (
            <Text className="mb-4 text-center text-xs text-slate-400">
              {load.loading_city || load.loading_pincode} → {load.unloading_city || load.unloading_pincode} · {t('askingPrice')} ₹{Number(load.bhada_price).toLocaleString('en-IN')}
            </Text>
          )}

          {presets.length > 0 && (
            <View className="mb-3 flex-row flex-wrap gap-2">
              {presets.map((p) => (
                <Button
                  key={p}
                  mode={Number(amount) === p ? 'contained' : 'outlined'}
                  buttonColor={Number(amount) === p ? '#f97316' : undefined}
                  textColor={Number(amount) === p ? 'white' : '#334155'}
                  compact
                  onPress={() => setAmount(String(p))}
                >
                  ₹{p.toLocaleString('en-IN')}
                </Button>
              ))}
            </View>
          )}

          <TextInput
            mode="outlined"
            keyboardType="number-pad"
            placeholder={t('enterAmount')}
            value={amount}
            onChangeText={setAmount}
            left={<TextInput.Icon icon="currency-inr" />}
            className="mb-3"
          />
          {!!error && <Text className="mb-3 text-sm text-red-600">{error}</Text>}
          <Button
            mode="contained"
            buttonColor="#f97316"
            loading={loading}
            disabled={!amount || Number(amount) <= 0 || loading}
            onPress={() => onSubmit(Number(amount))}
            className="mb-3"
          >
            {t('placeBid')}
          </Button>
          <Button mode="text" onPress={handleClose}>
            {t('cancel')}
          </Button>
        </View>
      </View>
    </Modal>
  );
}
