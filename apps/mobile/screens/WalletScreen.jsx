import { useState, useMemo } from 'react';
import { View, Text, Image, ScrollView, Modal, Alert, Share, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Icon, TextInput, Button, Chip } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { downloadQr } from '../lib/downloadQr';
import { DEFAULT_UPI_PAYEE, VIVEK_UPI_PAYEE } from '../lib/upi';
import ConfirmDetailsCheckbox from '../components/ConfirmDetailsCheckbox';
import CopyableUpiId from '../components/CopyableUpiId';
import UpiAppButtons from '../components/UpiAppButtons';
import QrCodeModal from '../components/QrCodeModal';
import DocumentUploadRow from '../components/DocumentUploadRow';

// Manual "Add Balance" flow (replaces Razorpay): user picks a reason tag,
// gets a transaction_id immediately, pays via the QR/bank details already on
// this screen, then attaches a screenshot against that transaction_id from
// history below. Wallet is only ever credited once staff verify the
// screenshot (see routes/wallet.js's POST /topup-requests/:id/verify).
const TOPUP_REASON_CATEGORIES = ['security_fee', 'service_charge', 'load_payment', 'other'];
const TOPUP_REASON_LABEL_KEYS = {
  security_fee: 'reasonSecurityFee',
  service_charge: 'reasonServiceCharge',
  load_payment: 'reasonLoadPayment',
  other: 'reasonOther'
};
const TOPUP_STATUS_STYLE = {
  awaiting_payment: { bg: 'bg-orange-100', text: 'text-orange-700', key: 'topupStatusAwaitingPayment' },
  pending_verification: { bg: 'bg-blue-100', text: 'text-blue-700', key: 'topupStatusPendingVerification' },
  rejected: { bg: 'bg-red-100', text: 'text-red-700', key: 'topupStatusRejected' }
};

const TXN_META = {
  add_money: { labelKey: 'walletTxnAddMoney', icon: 'plus-circle-outline', positive: true },
  credit: { labelKey: 'walletTxnCredit', icon: 'arrow-down-circle-outline', positive: true },
  debit: { labelKey: 'walletTxnDebit', icon: 'arrow-up-circle-outline', positive: false },
  refund: { labelKey: 'walletTxnRefund', icon: 'cash-refund', positive: true },
  commission: { labelKey: 'walletTxnCommission', icon: 'percent-outline', positive: false },
  service_charge: { labelKey: 'walletTxnServiceCharge', icon: 'receipt-text-outline', positive: false },
  security_hold: { labelKey: 'walletTxnSecurityHold', icon: 'lock-outline', positive: false },
  security_release: { labelKey: 'walletTxnSecurityRelease', icon: 'lock-open-outline', positive: true },
  withdrawal: { labelKey: 'walletTxnWithdrawal', icon: 'bank-transfer-out', positive: false }
};

const WITHDRAWAL_STATUS_STYLE = {
  pending: { bg: 'bg-orange-100', text: 'text-orange-700', key: 'withdrawalStatusPending' },
  approved: { bg: 'bg-blue-100', text: 'text-blue-700', key: 'withdrawalStatusApproved' },
  rejected: { bg: 'bg-red-100', text: 'text-red-700', key: 'withdrawalStatusRejected' },
  paid: { bg: 'bg-green-100', text: 'text-green-700', key: 'withdrawalStatusPaid' }
};

function TransactionRow({ txn, t }) {
  const meta = TXN_META[txn.type] ?? { labelKey: null, icon: 'swap-horizontal', positive: true };
  const isPending = txn.status && txn.status !== 'completed';
  return (
    <View className="mb-3 flex-row items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <View className="mr-3 flex-1 flex-row items-center">
        <Icon source={meta.icon} size={22} color={isPending ? '#94a3b8' : meta.positive ? '#16a34a' : '#dc2626'} />
        <View className="ml-3 flex-1">
          <Text className="text-sm font-semibold text-slate-800">{meta.labelKey ? t(meta.labelKey) : txn.type}</Text>
          <Text className="text-xs text-slate-400">{new Date(txn.created_at).toLocaleString()}</Text>
          <Text className="text-xs text-slate-400">{txn.transaction_id}</Text>
          {isPending && <Text className="mt-0.5 text-xs font-semibold text-orange-600">{t('txnStatusPending')}</Text>}
        </View>
      </View>
      <Text className={`text-base font-bold ${isPending ? 'text-slate-400' : meta.positive ? 'text-green-600' : 'text-red-600'}`}>
        {meta.positive ? '+' : '-'}₹{Number(txn.amount).toLocaleString('en-IN')}
      </Text>
    </View>
  );
}

// Renders a not-yet-verified "Add Balance" request in Transaction History
// (once verified, the real wallet_transactions row — same transaction_id —
// takes over and this row stops being fetched by GET /topup-requests/mine's
// caller). DocumentUploadRow is reused as-is for the proof attach/replace
// button — it already handles the take-photo/gallery/pdf picker, upload,
// and confirm-with-backend flow generically.
function TopupRequestRow({ topup, t, onProofUploaded }) {
  const style = TOPUP_STATUS_STYLE[topup.status] ?? TOPUP_STATUS_STYLE.awaiting_payment;
  const reasonLabel = t(TOPUP_REASON_LABEL_KEYS[topup.reason_category] ?? 'reasonOther');
  const canAttachProof = topup.status === 'awaiting_payment' || topup.status === 'pending_verification';

  return (
    <View className="mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <View className="flex-row items-center justify-between">
        <View className="mr-3 flex-1 flex-row items-center">
          <Icon source="progress-clock" size={22} color="#94a3b8" />
          <View className="ml-3 flex-1">
            <Text className="text-sm font-semibold text-slate-800">{reasonLabel}</Text>
            {topup.reason_category === 'other' && !!topup.reason_note && (
              <Text className="text-xs text-slate-500">{topup.reason_note}</Text>
            )}
            <Text className="text-xs text-slate-400">{new Date(topup.created_at).toLocaleString()}</Text>
            <Text className="text-xs text-slate-400">{topup.transaction_id}</Text>
          </View>
        </View>
        <Text className="text-base font-bold text-slate-400">+₹{Number(topup.amount).toLocaleString('en-IN')}</Text>
      </View>

      <View className="mt-2 flex-row items-center justify-between">
        <View className={`rounded-full px-3 py-1 ${style.bg}`}>
          <Text className={`text-xs font-semibold ${style.text}`}>{t(style.key)}</Text>
        </View>
        {topup.status === 'rejected' && !!topup.rejection_reason && (
          <Text className="ml-2 flex-1 text-right text-xs text-red-600">{topup.rejection_reason}</Text>
        )}
      </View>

      {canAttachProof && (
        <View className="mt-3">
          <DocumentUploadRow
            bucket="wallet-payment-proofs"
            documentType="proof"
            label={t('addPaymentProof')}
            icon="camera-outline"
            uploadedDoc={topup.proof_storage_path ? { uploaded: true } : null}
            getUploadUrl={(_docType, file_name) => api.wallet.topupRequests.uploadUrl(topup.id, file_name)}
            confirmUpload={(payload) => api.wallet.topupRequests.confirmProof(topup.id, { storage_path: payload.storage_path })}
            onUploaded={onProofUploaded}
          />
        </View>
      )}
    </View>
  );
}

function AmountModal({ visible, title, onClose, onSubmit, loading, error }) {
  const [amount, setAmount] = useState('');
  const [localError, setLocalError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  const handleClose = () => {
    setAmount('');
    setLocalError('');
    setConfirmed(false);
    onClose();
  };

  const handleSubmit = () => {
    setLocalError('');
    if (!amount.trim() || Number(amount) <= 0) return setLocalError(t('enterAmount'));
    onSubmit(Number(amount));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-3xl bg-white p-5" style={{ paddingBottom: Math.max(insets.bottom, 20) + 12 }}>
          <Text className="mb-4 text-center text-base font-bold text-slate-900">{title}</Text>
          <TextInput
            mode="outlined"
            keyboardType="number-pad"
            placeholder={t('enterAmount')}
            value={amount}
            onChangeText={setAmount}
            left={<TextInput.Icon icon="currency-inr" />}
            className="mb-3"
          />
          {!!(localError || error) && <Text className="mb-3 text-sm text-red-600">{localError || error}</Text>}

          <ConfirmDetailsCheckbox checked={confirmed} onChange={setConfirmed} t={t} />

          <Button
            mode="contained"
            buttonColor="#f97316"
            loading={loading}
            disabled={loading || !confirmed}
            onPress={handleSubmit}
            className="mb-3"
          >
            {title}
          </Button>
          <Button mode="text" onPress={handleClose}>
            {t('cancel')}
          </Button>
        </View>
      </View>
    </Modal>
  );
}

function AddBalanceModal({ visible, onClose, onSubmit, loading, error }) {
  const [amount, setAmount] = useState('');
  const [reasonCategory, setReasonCategory] = useState('load_payment');
  const [reasonNote, setReasonNote] = useState('');
  const [localError, setLocalError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  const handleClose = () => {
    setAmount('');
    setReasonCategory('load_payment');
    setReasonNote('');
    setLocalError('');
    setConfirmed(false);
    onClose();
  };

  const handleSubmit = () => {
    setLocalError('');
    if (!amount.trim() || Number(amount) <= 0) return setLocalError(t('enterAmount'));
    if (reasonCategory === 'other' && !reasonNote.trim()) return setLocalError(t('enterReasonNote'));
    onSubmit({ amount: Number(amount), reason_category: reasonCategory, reason_note: reasonCategory === 'other' ? reasonNote.trim() : undefined });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-3xl bg-white p-5" style={{ paddingBottom: Math.max(insets.bottom, 20) + 12 }}>
          <Text className="mb-4 text-center text-base font-bold text-slate-900">{t('addBalance')}</Text>
          <TextInput
            mode="outlined"
            keyboardType="number-pad"
            placeholder={t('enterAmount')}
            value={amount}
            onChangeText={setAmount}
            left={<TextInput.Icon icon="currency-inr" />}
            className="mb-3"
          />

          <Text className="mb-2 text-sm text-slate-600">{t('reasonForAdding')}</Text>
          <View className="mb-3 flex-row flex-wrap gap-2">
            {TOPUP_REASON_CATEGORIES.map((category) => (
              <Chip key={category} selected={reasonCategory === category} onPress={() => setReasonCategory(category)} compact>
                {t(TOPUP_REASON_LABEL_KEYS[category])}
              </Chip>
            ))}
          </View>
          {reasonCategory === 'other' && (
            <TextInput
              mode="outlined"
              placeholder={t('enterReasonNote')}
              value={reasonNote}
              onChangeText={setReasonNote}
              className="mb-3"
            />
          )}

          {!!(localError || error) && <Text className="mb-3 text-sm text-red-600">{localError || error}</Text>}

          <ConfirmDetailsCheckbox checked={confirmed} onChange={setConfirmed} t={t} />

          <Button
            mode="contained"
            buttonColor="#f97316"
            loading={loading}
            disabled={loading || !confirmed}
            onPress={handleSubmit}
            className="mb-3"
          >
            {t('addBalance')}
          </Button>
          <Button mode="text" onPress={handleClose}>
            {t('cancel')}
          </Button>
        </View>
      </View>
    </Modal>
  );
}

export default function WalletScreen() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const { data: wallet, isLoading: isLoadingWallet, error: walletError, refetch: refetchWallet } = useQuery({
    queryKey: ['wallet'],
    queryFn: api.wallet.balance
  });
  const { data: transactions = [] } = useQuery({ queryKey: ['walletTransactions'], queryFn: () => api.wallet.transactions() });
  const { data: withdrawals = [] } = useQuery({ queryKey: ['walletWithdrawals'], queryFn: api.wallet.withdrawalsMine });
  const { data: topupRequests = [] } = useQuery({ queryKey: ['walletTopupRequests'], queryFn: api.wallet.topupRequests.mine });

  const [addBalanceVisible, setAddBalanceVisible] = useState(false);
  const [withdrawVisible, setWithdrawVisible] = useState(false);
  const [qrModal, setQrModal] = useState(null); // 'iom' | 'vivek' | null

  const refreshWallet = () => {
    queryClient.invalidateQueries({ queryKey: ['wallet'] });
    queryClient.invalidateQueries({ queryKey: ['walletTransactions'] });
    queryClient.invalidateQueries({ queryKey: ['walletWithdrawals'] });
    queryClient.invalidateQueries({ queryKey: ['walletTopupRequests'] });
  };

  // History merges the real ledger (transactions) with not-yet-verified
  // top-up requests — once a request is verified, the matching
  // wallet_transactions row (same transaction_id) takes over, so verified
  // requests are dropped here to avoid showing the same money twice.
  const history = useMemo(() => {
    const pendingTopups = topupRequests
      .filter((r) => r.status !== 'verified')
      .map((r) => ({ kind: 'topup', created_at: r.created_at, data: r }));
    const ledgerRows = transactions.map((tx) => ({ kind: 'transaction', created_at: tx.created_at, data: tx }));
    return [...pendingTopups, ...ledgerRows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [transactions, topupRequests]);

  const createTopup = useMutation({
    mutationFn: (body) => api.wallet.topupRequests.create(body),
    onSuccess: (topup) => {
      setAddBalanceVisible(false);
      refreshWallet();
      Alert.alert(
        t('addBalance'),
        `${t('topupCreatedTxnIdLabel')}: ${topup.transaction_id}\n\n${t('topupCreatedInstructions')}`
      );
    },
    onError: (err) => Alert.alert(t('addBalance'), err.message)
  });

  const withdraw = useMutation({
    mutationFn: (amount) => api.wallet.withdraw(amount),
    onSuccess: () => {
      setWithdrawVisible(false);
      refreshWallet();
      Alert.alert(t('withdraw'), t('withdrawalRequestSent'));
    }
  });

  const handleDownloadStatement = async () => {
    try {
      const csv = await api.wallet.statementCsv();
      await Share.share({ message: csv, title: t('downloadStatement') });
    } catch (err) {
      Alert.alert(t('downloadStatement'), err.message);
    }
  };

  if (isLoadingWallet) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  if (walletError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Icon source="alert-circle-outline" size={40} color="#dc2626" />
        <Text className="mb-4 mt-3 text-center text-sm text-slate-500">{t('walletLoadFailed')}</Text>
        <Button mode="contained" buttonColor="#f97316" onPress={() => refetchWallet()}>
          {t('retry')}
        </Button>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 16 }}>
      <View className="mb-4 rounded-2xl bg-navy p-5">
        <Text className="text-sm text-slate-300">{t('walletBalance')}</Text>
        <Text className="mt-1 text-3xl font-bold text-white">₹{Number(wallet?.balance ?? 0).toLocaleString('en-IN')}</Text>
        <Text className="mt-2 text-xs text-slate-400">
          {t('availableBalance')}: ₹{Number(wallet?.available_balance ?? 0).toLocaleString('en-IN')}
        </Text>
        <View className="mt-4 flex-row gap-2">
          <Button
            mode="contained"
            buttonColor="#f97316"
            icon="plus-circle-outline"
            className="flex-1"
            onPress={() => setAddBalanceVisible(true)}
          >
            {t('addBalance')}
          </Button>
          <Button
            mode="outlined"
            textColor="#ffffff"
            style={{ borderColor: '#ffffff' }}
            icon="bank-transfer-out"
            className="flex-1"
            onPress={() => setWithdrawVisible(true)}
          >
            {t('withdraw')}
          </Button>
        </View>
      </View>

      {/* LOAD24's own payment details — same static info shown on Home, kept
          here too since Wallet is the more natural place to look them up
          when actually paying/settling. */}
      <Text className="mb-3 text-lg font-bold text-slate-900">{t('paymentDetails')}</Text>

      <View className="mb-4 rounded-2xl border border-orange-200 bg-white p-5">
        <View className="mb-3 flex-row items-center">
          <View className="mr-2 h-8 w-8 items-center justify-center rounded-full bg-orange-100">
            <Icon source="qrcode" size={18} color="#f97316" />
          </View>
          <Text className="text-base font-bold text-slate-900">{t('upiPayment')}</Text>
        </View>

        <View className="flex-row">
          <View className="flex-1 pr-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-slate-400">UPI ID</Text>
              <TouchableOpacity className="flex-row items-center" onPress={() => setQrModal('iom')} hitSlop={8}>
                <Icon source="qrcode" size={12} color="#f97316" />
                <Text className="ml-1 text-xs font-semibold text-brand">{t('showQr')}</Text>
              </TouchableOpacity>
            </View>
            <CopyableUpiId upiId={DEFAULT_UPI_PAYEE.pa} />
            <Text className="text-xs text-slate-400">{t('merchantName')}</Text>
            <Text className="text-sm font-semibold text-slate-800">INTERNATIONAL ONLINE MEDIA</Text>
          </View>
          <View className="items-center justify-center rounded-lg border border-slate-200 p-2">
            <Image source={require('../assets/IOM-upi-qr.jpeg')} style={{ width: 56, height: 56 }} resizeMode="contain" />
            <TouchableOpacity onPress={() => downloadQr('qr/IOM-upi-qr.jpeg', 'IOM-upi-qr.jpeg', t)}>
              <Text className="mt-1 text-xs font-semibold text-brand">↓ {t('download')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <UpiAppButtons payee={DEFAULT_UPI_PAYEE} t={t} />
        <Text className="mt-3 text-xs text-green-700">✓ {t('allUpiAppsAccepted')}</Text>
      </View>

      {/* Alternate authorized UPI collection contact, alongside (not
          replacing) the company account above. */}
      <View className="mb-4 rounded-2xl border border-purple-200 bg-white p-5">
        <View className="mb-3 flex-row items-center">
          <View className="mr-2 h-8 w-8 items-center justify-center rounded-full bg-purple-100">
            <Icon source="qrcode" size={18} color="#7c3aed" />
          </View>
          <Text className="text-base font-bold text-slate-900">Vivek Gupta</Text>
        </View>

        <View className="flex-row">
          <View className="flex-1 pr-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-slate-400">UPI ID</Text>
              <TouchableOpacity className="flex-row items-center" onPress={() => setQrModal('vivek')} hitSlop={8}>
                <Icon source="qrcode" size={12} color="#7c3aed" />
                <Text className="ml-1 text-xs font-semibold text-purple-700">{t('showQr')}</Text>
              </TouchableOpacity>
            </View>
            <CopyableUpiId upiId={VIVEK_UPI_PAYEE.pa} />
          </View>
          <View className="items-center justify-center rounded-lg border border-slate-200 p-2">
            <Image source={require('../assets/vivek-upi-qr.jpeg')} style={{ width: 56, height: 56 }} resizeMode="contain" />
            <TouchableOpacity onPress={() => downloadQr('qr/vivek-upi-qr.jpeg', 'vivek-upi-qr.jpeg', t)}>
              <Text className="mt-1 text-xs font-semibold text-brand">↓ {t('download')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <UpiAppButtons payee={VIVEK_UPI_PAYEE} t={t} />
        <Text className="mt-3 text-xs text-green-700">✓ {t('allUpiAppsAccepted')}</Text>
      </View>

      <View className="mb-4 rounded-2xl border border-slate-200 bg-white p-5">
        <View className="mb-3 flex-row items-center">
          <View className="mr-2 h-8 w-8 items-center justify-center rounded-full bg-blue-100">
            <Icon source="bank-outline" size={18} color="#2563eb" />
          </View>
          <Text className="text-base font-bold text-slate-900">{t('bankAccount')}</Text>
        </View>
        <Text className="text-xs text-slate-400">{t('accountName')}</Text>
        <Text className="mb-2 text-sm font-semibold text-slate-800">INTERNATIONAL ONLINE MEDIA</Text>
        <Text className="text-xs text-slate-400">{t('accountNumber')}</Text>
        <Text className="mb-2 text-sm font-semibold text-blue-600">003105501891</Text>
        <View className="flex-row justify-between">
          <View>
            <Text className="text-xs text-slate-400">{t('ifscCode')}</Text>
            <Text className="text-sm font-semibold text-slate-800">ICIC0000031</Text>
          </View>
          <View>
            <Text className="text-xs text-slate-400">{t('bank')}</Text>
            <Text className="text-sm font-semibold text-slate-800">ICICI BANK</Text>
          </View>
        </View>
      </View>

      {withdrawals.length > 0 && (
        <View className="mb-4">
          {withdrawals.map((wr) => {
            const style = WITHDRAWAL_STATUS_STYLE[wr.status] ?? WITHDRAWAL_STATUS_STYLE.pending;
            return (
              <View key={wr.id} className="mb-2 flex-row items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <Text className="text-sm font-semibold text-slate-800">₹{Number(wr.amount).toLocaleString('en-IN')}</Text>
                <View className={`rounded-full px-3 py-1 ${style.bg}`}>
                  <Text className={`text-xs font-semibold ${style.text}`}>{t(style.key)}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-lg font-bold text-slate-900">{t('transactionHistory')}</Text>
        <Button mode="text" icon="download-outline" onPress={handleDownloadStatement}>
          {t('downloadStatement')}
        </Button>
      </View>

      {history.length === 0 ? (
        <View className="items-center py-10">
          <Icon source="wallet-outline" size={40} color="#cbd5e1" />
          <Text className="mt-3 text-sm text-slate-400">{t('noTransactionsYet')}</Text>
        </View>
      ) : (
        history.map((row) =>
          row.kind === 'topup' ? (
            <TopupRequestRow key={`topup-${row.data.id}`} topup={row.data} t={t} onProofUploaded={refreshWallet} />
          ) : (
            <TransactionRow key={`txn-${row.data.id}`} txn={row.data} t={t} />
          )
        )
      )}

      <AddBalanceModal
        visible={addBalanceVisible}
        onClose={() => setAddBalanceVisible(false)}
        onSubmit={(body) => createTopup.mutate(body)}
        loading={createTopup.isPending}
        error={createTopup.error?.message}
      />
      <AmountModal
        visible={withdrawVisible}
        title={t('withdraw')}
        onClose={() => setWithdrawVisible(false)}
        onSubmit={(amount) => withdraw.mutate(amount)}
        loading={withdraw.isPending}
        error={withdraw.error?.message}
      />

      <QrCodeModal
        visible={qrModal === 'iom'}
        onClose={() => setQrModal(null)}
        qrSource={require('../assets/IOM-upi-qr.jpeg')}
        assetPath="qr/IOM-upi-qr.jpeg"
        filename="IOM-upi-qr.jpeg"
        title={t('upiPayment')}
        upiId={DEFAULT_UPI_PAYEE.pa}
        t={t}
      />
      <QrCodeModal
        visible={qrModal === 'vivek'}
        onClose={() => setQrModal(null)}
        qrSource={require('../assets/vivek-upi-qr.jpeg')}
        assetPath="qr/vivek-upi-qr.jpeg"
        filename="vivek-upi-qr.jpeg"
        title="Vivek Gupta"
        upiId={VIVEK_UPI_PAYEE.pa}
        t={t}
      />
    </ScrollView>
  );
}
