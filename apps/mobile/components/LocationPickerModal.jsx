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

// Full-screen "select locations" step for FindLoadsScreen's location filter —
// tapping the search-by-pincode-or-city field opens this instead of typing
// straight into it. Supports picking several cities/pincodes at once (the
// backend ORs every pick together — see routes/loads.js), plus a distinct
// pincode row (with a live city/state lookup) when the typed query is
// numeric, instead of lumping it in with the generic free-text search.
export default function LocationPickerModal({ visible, initialValues, onApply, onClose, t }) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [pincodeInfo, setPincodeInfo] = useState(null);
  const [pincodeLoading, setPincodeLoading] = useState(false);

  // Re-seed picks from whatever's already applied each time this opens, and
  // start with a blank search box — nothing to prefill a multi-select with.
  useEffect(() => {
    if (visible) {
      setSelected(initialValues || []);
      setQuery('');
    }
  }, [visible, initialValues]);

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

  const toggle = (value) => {
    setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const addFromSearch = (value) => {
    toggle(value);
    setQuery('');
  };

  const apply = (values) => {
    onApply(values);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center justify-between border-b border-slate-200 px-4 py-3">
          <View className="flex-row items-center gap-2">
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon source="arrow-left" size={22} color="#334155" />
            </TouchableOpacity>
            <Text className="text-base font-bold text-slate-900">{t('selectLocation')}</Text>
          </View>
          <TouchableOpacity onPress={() => apply(selected)} hitSlop={8}>
            <Text className="text-sm font-bold text-brand">
              {t('done')}{selected.length ? ` (${selected.length})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {selected.length > 0 && (
          <View className="flex-row flex-wrap gap-2 px-4 pt-3">
            {selected.map((value) => (
              <TouchableOpacity
                key={value}
                className="flex-row items-center gap-1 rounded-full bg-brand px-3 py-1.5"
                onPress={() => toggle(value)}
              >
                <Text className="text-xs font-semibold text-white">{value}</Text>
                <Icon source="close" size={14} color="#fff" />
              </TouchableOpacity>
            ))}
          </View>
        )}

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
                onPress={() => apply([])}
              >
                <Icon source="map-marker-radius-outline" size={18} color="#f97316" />
                <Text className="font-semibold text-slate-700">{t('allLocations')}</Text>
              </TouchableOpacity>

              {!!trimmedQuery && isNumericQuery && (
                <TouchableOpacity
                  className={`mb-4 flex-row items-center gap-2 rounded-xl border px-4 py-3 ${
                    selected.includes(trimmedQuery) ? 'border-brand bg-orange-100' : 'border-brand bg-orange-50'
                  }`}
                  onPress={() => addFromSearch(trimmedQuery)}
                >
                  <Icon
                    source={selected.includes(trimmedQuery) ? 'check-circle' : 'map-marker-outline'}
                    size={18}
                    color="#f97316"
                  />
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
                  className={`mb-4 flex-row items-center gap-2 rounded-xl border px-4 py-3 ${
                    selected.includes(trimmedQuery) ? 'border-brand bg-orange-100' : 'border-brand bg-orange-50'
                  }`}
                  onPress={() => addFromSearch(trimmedQuery)}
                >
                  <Icon source={selected.includes(trimmedQuery) ? 'check-circle' : 'magnify'} size={18} color="#f97316" />
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
            const isSelected = selected.includes(city);
            return (
              <TouchableOpacity
                className={`mb-3 flex-1 flex-row items-center gap-2 rounded-xl border px-4 py-3 ${
                  isSelected ? 'border-brand bg-orange-50' : 'border-slate-200'
                }`}
                onPress={() => toggle(city)}
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
