import { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Linking, Alert } from 'react-native';
import { Icon, Button, TextInput, HelperText } from 'react-native-paper';
import { useRoute } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { AXLE_LABELS, BODY_TYPE_LABELS, SPECIAL_CONDITION_LABELS } from '../lib/loadOptions';
import LoadCard from '../components/LoadCard';
import DocumentUploadRow from '../components/DocumentUploadRow';

// The two paperwork slots either trip party can attach once a bid is approved
// (backend: POST /api/load-bids/load/:id/documents — see routes/loadBids.js).
const TRIP_DOC_TYPES = [
  // `numberField` adds the "E-Way Bill Number" input under the upload row
  // (POST /api/load-bids/load/:id/documents/number) — E-Way Bill only for now.
  { type: 'eway_bill', labelKey: 'ewayBill', icon: 'file-document-outline', numberField: true },
  { type: 'bilty', labelKey: 'bilty', icon: 'clipboard-text-outline' }
];

// The 12-digit GST E-Way Bill number. '' is allowed through so a wrong number
// can be cleared; the backend applies the same rule.
const EWAY_BILL_NUMBER_RE = /^\d{12}$/;

// bookings.status (spec §8) -> i18n key for the label shown next to the ref.
const BOOKING_STATUS_TKEY = {
  confirmed: 'bookingStatusConfirmed',
  in_transit: 'bookingStatusInTransit',
  completed: 'bookingStatusCompleted',
  cancelled: 'bookingStatusCancelled'
};

function InfoRow({ icon, label, value }) {
  if (!value) return null;
  return (
    <View className="flex-row items-center gap-2 py-1.5">
      <Icon source={icon} size={16} color="#64748b" />
      <Text className="text-xs text-slate-400">{label}</Text>
      <Text className="flex-1 text-right text-sm font-semibold text-slate-800" numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function PartyCard({ title, party, t }) {
  return (
    <View className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
      <Text className="mb-3 text-base font-bold text-slate-900">{title}</Text>
      <InfoRow icon="account-outline" label={t('fullName')} value={party.full_name} />
      <InfoRow icon="office-building-outline" label={t('companyName')} value={party.company_name} />
      <InfoRow icon="map-marker-outline" label={t('location')} value={[party.city, party.state].filter(Boolean).join(', ')} />
      <InfoRow icon="star-outline" label={t('trustScore')} value={party.trust_score != null ? String(party.trust_score) : null} />

      {!!party.mobile && (
        <TouchableOpacity
          onPress={() => Linking.openURL(`tel:${party.mobile}`)}
          className="mt-3 flex-row items-center justify-center gap-2 rounded-xl bg-green-600 py-3"
        >
          <Icon source="phone" size={18} color="#ffffff" />
          <Text className="text-sm font-bold text-white">{party.mobile}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// The E-Way Bill number printed on the bill, entered below its upload row.
// Persisted on the same trip document (either party can set/clear it) so it
// survives independently of whether a file has been attached yet.
function EwayBillNumberRow({ label, value, onSave, onSaved, t }) {
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);

  // Re-seed when the saved value changes under us (e.g. after onChanged refetch,
  // or the other party sets it).
  useEffect(() => setText(value), [value]);

  const trimmed = text.trim();
  const invalid = trimmed !== '' && !EWAY_BILL_NUMBER_RE.test(trimmed);
  const dirty = trimmed !== value;

  const save = async () => {
    setBusy(true);
    try {
      await onSave(trimmed);
      onSaved();
    } catch (err) {
      Alert.alert(t('uploadFailed'), err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="-mt-1 mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <Text className="mb-2 text-xs font-semibold text-slate-500">{label}</Text>
      <TextInput
        mode="outlined"
        dense
        keyboardType="number-pad"
        maxLength={12}
        placeholder={t('ewayBillNumberPlaceholder')}
        value={text}
        onChangeText={setText}
      />
      {invalid && (
        <HelperText type="error" visible padding="none">
          {t('ewayBillNumberInvalid')}
        </HelperText>
      )}
      <View className="mt-2 flex-row">
        <Button
          mode="contained"
          buttonColor="#f97316"
          compact
          loading={busy}
          disabled={busy || !dirty || invalid}
          onPress={save}
        >
          {t('save')}
        </Button>
      </View>
    </View>
  );
}

// E-Way Bill + Bilty upload slots, shown to both trip parties. Each row is an
// upload/replace control; once a file is on record it also gets a View button
// that opens the (short-lived, signed) URL from the trip-details payload. The
// E-Way Bill row also carries a number field (see EwayBillNumberRow).
function TripDocumentsCard({ loadId, documents, viewerEmail, onChanged, t }) {
  return (
    <View className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
      <Text className="mb-3 text-base font-bold text-slate-900">{t('tripDocuments')}</Text>
      {TRIP_DOC_TYPES.map(({ type, labelKey, icon, numberField }) => {
        const doc = documents?.[type];
        // A doc entry can exist with only a number and no file yet — the upload
        // row's "uploaded" state must track the file, not the entry.
        const fileDoc = doc?.has_file ? doc : null;
        const byYou = fileDoc?.uploaded_by_email && fileDoc.uploaded_by_email === viewerEmail;
        return (
          <View key={type}>
            <DocumentUploadRow
              bucket="trip-documents"
              documentType={type}
              label={t(labelKey)}
              icon={icon}
              uploadedDoc={fileDoc}
              getUploadUrl={(documentType, fileName) => api.loadBids.tripDocumentUploadUrl(loadId, documentType, fileName)}
              confirmUpload={(body) => api.loadBids.confirmTripDocument(loadId, body)}
              onUploaded={onChanged}
              onView={() => fileDoc?.url && Linking.openURL(fileDoc.url)}
            />
            {!!fileDoc && (
              <Text className="-mt-2 mb-3 ml-1 text-xs text-slate-400">
                {byYou ? t('uploadedByYou') : t('uploadedByOtherParty')}
              </Text>
            )}
            {numberField && (
              <EwayBillNumberRow
                label={t('ewayBillNumber')}
                value={doc?.document_number ?? ''}
                onSave={(document_number) =>
                  api.loadBids.setTripDocumentNumber(loadId, { document_type: type, document_number })
                }
                onSaved={onChanged}
                t={t}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

// Only reachable once a bid on this load is approved — the backend
// (GET /api/load-bids/load/:load_id/trip-details) enforces that only the
// load's poster or the approved bidder can fetch this, so a 403/404 here
// just needs a friendly message, not a retry.
export default function TripDetailsScreen() {
  const route = useRoute();
  const { loadId } = route.params;
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['tripDetails', loadId],
    queryFn: () => api.loadBids.tripDetails(loadId),
    retry: false
  });

  const deliverMutation = useMutation({
    mutationFn: () => api.loadBids.deliver(loadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tripDetails', loadId] });
      queryClient.invalidateQueries({ queryKey: ['myLoads'] });
      queryClient.invalidateQueries({ queryKey: ['myBids'] });
      Alert.alert(t('markDelivered'), t('tripDelivered'));
    },
    onError: (err) => Alert.alert(t('markDelivered'), err.message)
  });

  const confirmDeliver = () => {
    Alert.alert(t('markDelivered'), t('markDeliveredConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('markDelivered'), style: 'destructive', onPress: () => deliverMutation.mutate() }
    ]);
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator color="#f97316" />
      </View>
    );
  }

  if (error || !data) {
    const message =
      error?.status === 404
        ? t('noAcceptedBidYet')
        : error?.status === 403
        ? t('tripDetailsUnauthorized')
        : error?.message || t('comingSoonFeature');
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 px-8">
        <Text className="text-center text-sm text-slate-500">{message}</Text>
      </View>
    );
  }

  const { load, bid, booking, poster, accepter, viewer_role } = data;
  const otherParty = viewer_role === 'poster' ? accepter : poster;
  const viewerEmail = viewer_role === 'poster' ? poster?.email : accepter?.email;
  // The load's bhada_price is just the original asking price — once a bid is
  // approved, the actual agreed price is what was bid, so that's what the
  // trip (and everything derived from it) should show.
  const agreedLoad = bid?.amount != null ? { ...load, bhada_price: bid.amount } : load;

  const canDeliver = ['matched', 'in_transit'].includes(load.status);

  return (
    <ScrollView className="flex-1 bg-slate-50 px-4 pt-4">
      <LoadCard load={agreedLoad} hideActions />

      {!!(booking?.booking_ref || bid?.booking_ref) && (
        <View className="mb-4 flex-row items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-3">
          <Icon source="identifier" size={16} color="#64748b" />
          <Text className="text-xs text-slate-400">{t('bookingId')}</Text>
          <Text className="text-sm font-bold text-slate-900">{booking?.booking_ref || bid?.booking_ref}</Text>
          {!!booking?.status && (
            <Text className="text-xs font-semibold text-slate-500">· {t(BOOKING_STATUS_TKEY[booking.status] || 'bookingStatusConfirmed')}</Text>
          )}
        </View>
      )}

      {canDeliver ? (
        <TouchableOpacity
          onPress={confirmDeliver}
          disabled={deliverMutation.isPending}
          className="mb-4 flex-row items-center justify-center gap-2 rounded-xl bg-green-600 py-3.5"
        >
          <Icon source="check-circle-outline" size={18} color="#ffffff" />
          <Text className="text-base font-bold text-white">{t('markDelivered')}</Text>
        </TouchableOpacity>
      ) : load.status === 'completed' ? (
        <View className="mb-4 flex-row items-center justify-center gap-2 rounded-xl bg-slate-100 py-3.5">
          <Icon source="check-circle" size={18} color="#16a34a" />
          <Text className="text-sm font-bold text-slate-600">{t('tripAlreadyDelivered')}</Text>
        </View>
      ) : null}

      <View className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <Text className="mb-2 text-base font-bold text-slate-900">{t('loadDetails')}</Text>
        <InfoRow icon="map-marker-outline" label={t('from')} value={load.loading_address} />
        <InfoRow
          icon="account-outline"
          label={t('loadingPoc')}
          value={[load.loading_poc_name, load.loading_poc_mobile].filter(Boolean).join(' · ')}
        />
        <InfoRow icon="map-marker-outline" label={t('to')} value={load.unloading_address} />
        <InfoRow
          icon="account-outline"
          label={t('unloadingPoc')}
          value={[load.unloading_poc_name, load.unloading_poc_mobile].filter(Boolean).join(' · ')}
        />
        <InfoRow
          icon="axis-arrow"
          label={t('axleType')}
          value={load.axle_type === 'other' ? load.axle_type_other || t('other') : AXLE_LABELS[language]?.[load.axle_type]}
        />
        <InfoRow
          icon="cube-outline"
          label={t('bodyType')}
          value={load.body_type === 'other' ? load.body_type_other || t('other') : BODY_TYPE_LABELS[language]?.[load.body_type]}
        />
        <InfoRow icon="ruler" label={t('truckLength')} value={load.truck_length_ft ? `${load.truck_length_ft} ft` : null} />
        <InfoRow icon="map-marker-distance" label={t('distance')} value={load.distance_km ? `${load.distance_km} km` : null} />
        {!!load.special_conditions?.length && (
          <InfoRow
            icon="alert-circle-outline"
            label={t('specialConditions')}
            value={load.special_conditions.map((c) => SPECIAL_CONDITION_LABELS[language]?.[c] ?? c).join(', ')}
          />
        )}
        <InfoRow icon="text" label={t('customRequirement')} value={load.custom_requirement} />
      </View>

      <TripDocumentsCard
        loadId={loadId}
        documents={data.trip_documents}
        viewerEmail={viewerEmail}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ['tripDetails', loadId] })}
        t={t}
      />

      <PartyCard
        title={viewer_role === 'poster' ? t('loadAccepterDetails') : t('posterDetails')}
        party={otherParty}
        t={t}
      />
    </ScrollView>
  );
}
