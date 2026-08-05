import { useState } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator, PermissionsAndroid, Platform } from 'react-native';
import { Icon, Button, TextInput } from 'react-native-paper';
import Geolocation from '@react-native-community/geolocation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { KYC_DOCUMENT_META } from '../lib/kycDocuments';
import DocumentUploadRow from '../components/DocumentUploadRow';

const KYC_BUCKET = 'kyc-documents';

const KYC_BADGE = {
  pending: { key: 'kycStatusPending', bg: 'bg-slate-100', text: 'text-slate-600' },
  partial: { key: 'kycStatusPartial', bg: 'bg-orange-100', text: 'text-orange-700' },
  submitted: { key: 'kycStatusSubmitted', bg: 'bg-blue-100', text: 'text-blue-700' },
  verified: { key: 'kycStatusVerified', bg: 'bg-green-100', text: 'text-green-700' },
  rejected: { key: 'kycStatusRejected', bg: 'bg-red-100', text: 'text-red-700' }
};

async function requestLocationPermission(t) {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, {
    title: t('locationPermissionTitle'),
    message: t('locationPermissionMessage')
  });
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

function LocationRow({ location, t, onSaved }) {
  const isCaptured = !!(location?.address && location?.lat != null && location?.lng != null);
  const [address, setAddress] = useState(location?.address || '');
  const [coords, setCoords] = useState(
    location?.lat != null && location?.lng != null ? { lat: location.lat, lng: location.lng } : null
  );
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  const captureLocation = async () => {
    setLocating(true);
    try {
      const hasPermission = await requestLocationPermission(t);
      if (!hasPermission) {
        Alert.alert(t('locationPermissionTitle'), t('locationPermissionDenied'));
        return;
      }
      await new Promise((resolve, reject) => {
        Geolocation.getCurrentPosition(
          (pos) => {
            setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            resolve();
          },
          (err) => reject(new Error(err.message || 'Could not get location')),
          { enableHighAccuracy: true, timeout: 15000 }
        );
      });
    } catch (err) {
      Alert.alert(t('uploadFailed'), err.message);
    } finally {
      setLocating(false);
    }
  };

  const handleSave = async () => {
    if (!address.trim() || !coords) return;
    setSaving(true);
    try {
      await api.kyc.saveLocation({ address: address.trim(), lat: coords.lat, lng: coords.lng });
      onSaved();
    } catch (err) {
      Alert.alert(t('uploadFailed'), err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <View className="mb-3 flex-row items-center">
        <Icon source="map-marker-outline" size={22} color={isCaptured ? '#16a34a' : '#64748b'} />
        <View className="ml-3 flex-1">
          <Text className="text-sm font-semibold text-slate-800">{t('docLocation')}</Text>
          {isCaptured && <Text className="text-xs text-green-600">✓ {t('locationCaptured')}</Text>}
        </View>
      </View>

      <TextInput
        mode="outlined"
        dense
        placeholder={t('locationAddressPlaceholder')}
        value={address}
        onChangeText={setAddress}
        className="mb-3"
      />

      <View className="mb-3 flex-row items-center">
        <Button mode="outlined" compact onPress={captureLocation} loading={locating} disabled={locating}>
          {coords ? t('locationRecapture') : t('locationCapture')}
        </Button>
        {!!coords && (
          <Text className="ml-3 flex-1 text-xs text-slate-500">
            {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
          </Text>
        )}
      </View>

      <Button
        mode="contained"
        buttonColor="#f97316"
        compact
        onPress={handleSave}
        loading={saving}
        disabled={saving || !address.trim() || !coords}
      >
        {t('save')}
      </Button>
    </View>
  );
}

export default function KycVerificationScreen() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['kyc-case'], queryFn: api.kyc.case, retry: false });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['kyc-case'] });
    queryClient.invalidateQueries({ queryKey: ['profile'] });
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  if (!data) {
    // A 404 here means this role genuinely has no KYC requirement (staff/admin
    // accounts) — anything else is a real failure and shouldn't be dressed up
    // as "coming soon", or there's no way to ever notice/diagnose it.
    const message = error && error.status !== 404 ? error.message : t('comingSoonFeature');
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-center text-sm text-slate-500">{message}</Text>
      </View>
    );
  }

  const status = data.case.status;
  const badge = KYC_BADGE[status] ?? KYC_BADGE.pending;
  const isFinal = status === 'submitted' || status === 'verified';
  const documentsByType = Object.fromEntries((data.documents || []).map((d) => [d.document_type, d]));

  const renderDoc = (documentType) => {
    const meta = KYC_DOCUMENT_META[documentType] ?? { labelKey: null, icon: 'file-outline' };
    return (
      <DocumentUploadRow
        key={documentType}
        bucket={KYC_BUCKET}
        documentType={documentType}
        label={meta.labelKey ? t(meta.labelKey) : documentType}
        icon={meta.icon}
        uploadedDoc={documentsByType[documentType]}
        getUploadUrl={api.kyc.uploadUrl}
        confirmUpload={api.kyc.confirmDocument}
        onUploaded={refresh}
      />
    );
  };

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 20 }}>
      <View className="mb-5 items-center">
        <View className="mb-3 h-16 w-16 items-center justify-center rounded-full bg-blue-50">
          <Icon source="shield-check-outline" size={32} color="#2563eb" />
        </View>
        <View className={`mb-3 rounded-full px-4 py-2 ${badge.bg}`}>
          <Text className={`text-sm font-semibold ${badge.text}`}>{t(badge.key)}</Text>
        </View>
        <Text className="text-center text-sm text-slate-500">
          {isFinal ? t('kycAllDocumentsUploaded') : t('kycUploadDesc')}
        </Text>
      </View>

      {data.required_documents.map(renderDoc)}

      {data.requires_location && (
        <LocationRow location={data.location} t={t} onSaved={refresh} />
      )}

      {!!data.optional_documents?.length && (
        <>
          <Text className="mb-3 mt-2 text-sm font-semibold text-slate-500">{t('kycOptionalDocuments')}</Text>
          {data.optional_documents.map(renderDoc)}
        </>
      )}
    </ScrollView>
  );
}
