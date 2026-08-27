// Static shortlist for the location picker's "Popular Cities" grid — loads
// aren't backed by a canonical cities table (see routes/loads.js's comment
// on loading_city/unloading_city being free text the poster typed), so this
// is just a curated set of major freight hubs to tap instead of typing.
// City names stay in English/Latin script regardless of app language since
// that's how posters actually type loading_city/unloading_city.
export const POPULAR_CITIES = [
  'Mumbai', 'Delhi', 'Bengaluru', 'Pune', 'Chennai', 'Hyderabad', 'Kolkata',
  'Ahmedabad', 'Surat', 'Jaipur', 'Lucknow', 'Nagpur', 'Indore', 'Kanpur',
  'Chandigarh', 'Ludhiana', 'Nashik', 'Vadodara', 'Coimbatore', 'Bhopal'
];
