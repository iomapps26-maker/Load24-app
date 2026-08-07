import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Linking } from 'react-native';
import { Icon } from 'react-native-paper';
import { useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { AXLE_LABELS, BODY_TYPE_LABELS, SPECIAL_CONDITION_LABELS } from '../lib/loadOptions';
import { KYC_DOCUMENT_META } from '../lib/kycDocuments';
import LoadCard from '../components/LoadCard';

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

function DocumentLink({ doc, t }) {
  const meta = KYC_DOCUMENT_META[doc.document_type] ?? { labelKey: null, icon: 'file-outline' };
  const label = meta.labelKey ? t(meta.labelKey) : doc.document_type;
  return (
    <TouchableOpacity
      onPress={() => doc.url && Linking.openURL(doc.url)}
      disabled={!doc.url}
      className="mb-2 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-3"
    >
      <View className="mr-3 flex-1 flex-row items-center gap-2">
        <Icon source={meta.icon} size={18} color="#f97316" />
        <Text className="flex-1 text-sm font-semibold text-slate-800" numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Icon source="eye-outline" size={18} color="#f97316" />
    </TouchableOpacity>
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

      <Text className="mb-2 mt-4 text-sm font-semibold text-slate-500">{t('documents')}</Text>
      {party.documents?.length ? (
        party.documents.map((doc) => <DocumentLink key={doc.document_type} doc={doc} t={t} />)
      ) : (
        <Text className="text-xs text-slate-400">{t('noDocumentsUploaded')}</Text>
      )}
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

  const { data, isLoading, error } = useQuery({
    queryKey: ['tripDetails', loadId],
    queryFn: () => api.loadBids.tripDetails(loadId),
    retry: false
  });

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

  const { load, bid, poster, accepter, viewer_role } = data;
  const otherParty = viewer_role === 'poster' ? accepter : poster;
  // The load's bhada_price is just the original asking price — once a bid is
  // approved, the actual agreed price is what was bid, so that's what the
  // trip (and everything derived from it) should show.
  const agreedLoad = bid?.amount != null ? { ...load, bhada_price: bid.amount } : load;

  return (
    <ScrollView className="flex-1 bg-slate-50 px-4 pt-4">
      <LoadCard load={agreedLoad} hideActions />

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

      <PartyCard
        title={viewer_role === 'poster' ? t('loadAccepterDetails') : t('posterDetails')}
        party={otherParty}
        t={t}
      />
    </ScrollView>
  );
}
