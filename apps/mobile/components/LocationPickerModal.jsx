import { useMemo, useState, useEffect } from 'react';
import { Modal, View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Icon, TextInput } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { POPULAR_CITIES } from '../lib/popularCities';
import { INDIAN_CITIES } from '../lib/indianCities';
import { lookupPincode } from '../lib/pincodeLookup';

const PINCODE_LOOKUP_DEBOUNCE_MS = 400;
// Cap the type-ahead list — a two-column grid of hundreds of matches for a
// short query ("a", "ka") is just scroll, and FlatList stays cheap either way.
const MAX_CITY_SUGGESTIONS = 40;

// Full-screen "select a location" step for FindLoadsScreen's pickup and drop
// filters — tapping either the loading-point or the unloading-point field
// opens this instead of typing straight into it. Single pick: choosing a
// city/pincode applies it and closes immediately; "All Locations" clears the
// side. A numeric query gets a distinct pincode row (with a live city/state
// lookup) instead of being lumped in with the generic free-text search.
export default function LocationPickerModal({ visible, initialValue, onApply, onClose, t, title }) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [pincodeInfo, setPincodeInfo] = useState(null);
  const [pincodeLoading, setPincodeLoading] = useState(false);

  // Start every open with a blank search box — the applied value is shown on
  // the field behind this modal, not prefilled into the search.
  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const trimmedQuery = query.trim();
  const isNumericQuery = /^\d+$/.test(trimmedQuery);

  // Only a full 6-digit pincode is worth resolving to a city/state — shorter
  // digit strings are still valid as a prefix search (backend does ilike
  // '%text%' on the pincode field) but have nothing to look up yet.
  useEffect(() => {
    if (!/^\d{6}$/.test(trimmedQuery)) {
      setPincodeInfo(null);
      setPincodeLoading(false);
      return undefined;
    }
    let cancelled = false;
    setPincodeLoading(true);
    const timer = setTimeout(() => {
      lookupPincode(trimmedQuery)
        .then((result) => { if (!cancelled) setPincodeInfo(result); })
        .catch(() => { if (!cancelled) setPincodeInfo(null); })
        .finally(() => { if (!cancelled) setPincodeLoading(false); });
    }, PINCODE_LOOKUP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery]);

  // Empty box → the curated "popular" grid. As soon as the caller types a
  // name, suggest from the full ~1,300-city gazetteer instead (prefix matches
  // first, then any substring) so places outside the popular 20 — Noida,
  // Bhiwandi, Zirakpur — still surface. A numeric query is a pincode, handled
  // by its own row above, so no city list for it.
  const filteredCities = useMemo(() => {
    if (!trimmedQuery) return POPULAR_CITIES;
    if (isNumericQuery) return [];
    const q = trimmedQuery.toLowerCase();
    const startsWith = [];
    const contains = [];
    for (const city of INDIAN_CITIES) {
      const lc = city.toLowerCase();
      if (lc.startsWith(q)) startsWith.push(city);
      else if (lc.includes(q)) contains.push(city);
    }
    return [...startsWith, ...contains].slice(0, MAX_CITY_SUGGESTIONS);
  }, [trimmedQuery, isNumericQuery]);

  // When the typed text already exactly names a suggested city, the generic
  // "Search for …" row is just a duplicate — hide it in that case.
  const hasExactCityMatch = useMemo(
    () => filteredCities.some((city) => city.toLowerCase() === trimmedQuery.toLowerCase()),
    [filteredCities, trimmedQuery]
  );

  const apply = (value) => {
    onApply(value);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-2 border-b border-slate-200 px-4 py-3">
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Icon source="arrow-left" size={22} color="#334155" />
          </TouchableOpacity>
          <Text className="text-base font-bold text-slate-900">{title || t('selectLocation')}</Text>
        </View>

        <View className="px-4 pt-3">
          <TextInput
            mode="outlined"
            placeholder={t('searchCityOrPincode')}
            value={query}
            onChangeText={setQuery}
            autoFocus
            keyboardType="default"
            dense
            left={<TextInput.Icon icon="magnify" />}
            right={query ? <TextInput.Icon icon="close-circle" onPress={() => setQuery('')} /> : undefined}
          />
        </View>

        <FlatList
          data={filteredCities}
          keyExtractor={(city) => city}
          className="px-4"
          contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 16 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <>
              <TouchableOpacity
                className="mb-3 flex-row items-center gap-2 rounded-xl bg-slate-100 px-4 py-3"
                onPress={() => apply(null)}
              >
                <Icon source="map-marker-radius-outline" size={18} color="#f97316" />
                <Text className="font-semibold text-slate-700">{t('allLocations')}</Text>
              </TouchableOpacity>

              {!!trimmedQuery && isNumericQuery && (
                <TouchableOpacity
                  className="mb-4 flex-row items-center gap-2 rounded-xl border border-brand bg-orange-50 px-4 py-3"
                  onPress={() => apply(trimmedQuery)}
                >
                  <Icon source="map-marker-outline" size={18} color="#f97316" />
                  <View className="flex-1">
                    <Text className="font-semibold text-brand">{trimmedQuery}</Text>
                    {pincodeLoading && (
                      <Text className="text-xs text-slate-400">{t('lookingUpPincode')}</Text>
                    )}
                    {!pincodeLoading && pincodeInfo && (
                      <Text className="text-xs text-slate-500">{pincodeInfo.city}, {pincodeInfo.state}</Text>
                    )}
                  </View>
                  {pincodeLoading && <ActivityIndicator size={14} color="#f97316" />}
                </TouchableOpacity>
              )}

              {!!trimmedQuery && !isNumericQuery && !hasExactCityMatch && (
                <TouchableOpacity
                  className="mb-4 flex-row items-center gap-2 rounded-xl border border-brand bg-orange-50 px-4 py-3"
                  onPress={() => apply(trimmedQuery)}
                >
                  <Icon source="magnify" size={18} color="#f97316" />
                  <Text className="flex-1 font-semibold text-brand" numberOfLines={1}>
                    {t('useThisSearch')} "{trimmedQuery}"
                  </Text>
                </TouchableOpacity>
              )}

              {!trimmedQuery && (
                <Text className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                  {t('popularCities')}
                </Text>
              )}
            </>
          }
          numColumns={2}
          columnWrapperStyle={{ gap: 10 }}
          renderItem={({ item: city }) => {
            const isSelected = initialValue === city;
            return (
              <TouchableOpacity
                className={`mb-3 flex-1 flex-row items-center gap-2 rounded-xl border px-4 py-3 ${
                  isSelected ? 'border-brand bg-orange-50' : 'border-slate-200'
                }`}
                onPress={() => apply(city)}
              >
                <Icon
                  source={isSelected ? 'check-circle' : 'city-variant-outline'}
                  size={16}
                  color={isSelected ? '#f97316' : '#64748b'}
                />
                <Text className={`font-medium ${isSelected ? 'text-brand' : 'text-slate-700'}`}>{city}</Text>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            trimmedQuery && !isNumericQuery ? (
              <Text className="mt-4 text-center text-slate-400">{t('noCitiesFound')}</Text>
            ) : null
          }
        />
      </View>
    </Modal>
  );
}
