import { useState } from 'react';
import { View, Text, Alert, ActivityIndicator, Modal, Pressable } from 'react-native';
import { Icon, Button } from 'react-native-paper';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { pick, types as documentTypes } from '@react-native-documents/picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../lib/i18n';
import { beginExternalPicker, endExternalPicker } from '../lib/pickerGuard';
import { compressImageToLimit, assertFileWithinLimit } from '../lib/fileSizeLimit';

// Generalized out of the KYC verification screen's original document row —
// same take-photo/choose-from-gallery/attach-PDF flow, now reusable for any
// signed-upload-URL-then-confirm backend endpoint (KYC docs, truck docs, ...)
// instead of being hardcoded to the KYC bucket/routes.

// RN's fetch can read a local file:// / content:// / ph:// picker URI, but
// its Android fetch/OkHttp layer unreliably sends Blob-bodied HTTPS PUTs (a
// long-standing RN gap) — supabase-js's uploadToSignedUrl silently fails
// with "Network request failed" when given a Blob. An ArrayBuffer body goes
// through RN's binary-body path instead and uploads reliably.
async function uploadToSignedUrl(bucket, storagePath, token, file) {
  const response = await fetch(file.uri);
  const arrayBuffer = await response.arrayBuffer();
  const { error } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(storagePath, token, arrayBuffer, { contentType: file.type || 'application/octet-stream' });
  if (error) throw error;
}

// Android's native Alert.alert only reliably renders 3 buttons — a 4th
// (Cancel) silently disappears — so the source/Cancel choice is a real
// bottom-sheet modal instead, with Cancel always visible as its own row.
function PickerSheet({ visible, label, onTakePhoto, onChooseGallery, onAttachPdf, onCancel, t }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onCancel}>
        <Pressable
          className="rounded-t-3xl bg-white p-5"
          style={{ paddingBottom: Math.max(insets.bottom, 20) + 12 }}
          onPress={() => {}}
        >
          <Text className="mb-4 text-center text-base font-bold text-slate-900">{label}</Text>
          <Button mode="outlined" className="mb-3" onPress={onTakePhoto}>
            {t('takePhoto')}
          </Button>
          <Button mode="outlined" className="mb-3" onPress={onChooseGallery}>
            {t('chooseFromGallery')}
          </Button>
          <Button mode="outlined" className="mb-3" onPress={onAttachPdf}>
            {t('attachPdf')}
          </Button>
          <Button mode="text" onPress={onCancel}>
            {t('cancel')}
          </Button>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function DocumentUploadRow({ bucket, documentType, label, icon, uploadedDoc, getUploadUrl, confirmUpload, onUploaded }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);

  const handleFile = async (file) => {
    setBusy(true);
    try {
      const { storage_path, token } = await getUploadUrl(documentType, file.name);
      await uploadToSignedUrl(bucket, storage_path, token, file);
      await confirmUpload({
        document_type: documentType,
        storage_path,
        file_name: file.name,
        mime_type: file.type
      });
      onUploaded();
    } catch (err) {
      Alert.alert(t('uploadFailed'), err.message);
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async (fromCamera) => {
    setSheetVisible(false);
    beginExternalPicker();
    try {
      const result = fromCamera
        ? await launchCamera({ mediaType: 'photo', quality: 0.8 })
        : await launchImageLibrary({ mediaType: 'photo', quality: 0.8 });
      const asset = result?.assets?.[0];
      if (!asset?.uri) return;
      let compressed;
      try {
        compressed = await compressImageToLimit(asset.uri);
      } catch (err) {
        Alert.alert(t('uploadFailed'), t('imageCompressFailed'));
        return;
      }
      const baseName = (asset.fileName || `${documentType}.jpg`).replace(/\.[^./]+$/, '');
      await handleFile({ uri: compressed.uri, name: `${baseName}.jpg`, type: 'image/jpeg' });
    } finally {
      endExternalPicker();
    }
  };

  const pickPdf = async () => {
    setSheetVisible(false);
    beginExternalPicker();
    try {
      const result = await pick({ type: [documentTypes.pdf] });
      const picked = Array.isArray(result) ? result[0] : result;
      if (!picked?.uri) return;
      try {
        await assertFileWithinLimit(picked.uri);
      } catch (err) {
        Alert.alert(t('uploadFailed'), t('pdfTooLarge'));
        return;
      }
      await handleFile({ uri: picked.uri, name: picked.name || `${documentType}.pdf`, type: picked.type || 'application/pdf' });
    } catch (err) {
      const canceled = err?.code === 'DOCUMENT_PICKER_CANCELED' || /cancel/i.test(err?.message || '');
      if (!canceled) Alert.alert(t('uploadFailed'), err.message);
    } finally {
      endExternalPicker();
    }
  };

  return (
    <View className="mb-3 flex-row items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <View className="mr-3 flex-1 flex-row items-center">
        <Icon source={icon} size={22} color={uploadedDoc ? '#16a34a' : '#64748b'} />
        <View className="ml-3 flex-1">
          <Text className="text-sm font-semibold text-slate-800">{label}</Text>
          {!!uploadedDoc && <Text className="text-xs text-green-600">✓ {t('uploaded')}</Text>}
        </View>
      </View>
      {busy ? (
        <ActivityIndicator color="#f97316" />
      ) : (
        <Button
          mode={uploadedDoc ? 'outlined' : 'contained'}
          buttonColor={uploadedDoc ? undefined : '#f97316'}
          compact
          onPress={() => setSheetVisible(true)}
        >
          {uploadedDoc ? t('replace') : t('upload')}
        </Button>
      )}

      <PickerSheet
        visible={sheetVisible}
        label={label}
        onTakePhoto={() => pickPhoto(true)}
        onChooseGallery={() => pickPhoto(false)}
        onAttachPdf={pickPdf}
        onCancel={() => setSheetVisible(false)}
        t={t}
      />
    </View>
  );
}
