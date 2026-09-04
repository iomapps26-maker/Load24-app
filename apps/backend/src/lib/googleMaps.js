const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';

// Best-effort road-distance lookup for a load's pickup → drop route, used to
// fill loads.distance_km at posting time. Never throws — a missing/invalid
// GOOGLE_MAPS_API_KEY or an address Google can't geocode just means the load
// posts without a distance instead of failing the whole request.
export async function drivingDistanceKm(originAddress, destinationAddress) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || !originAddress || !destinationAddress) return null;

  const url = new URL(DISTANCE_MATRIX_URL);
  url.searchParams.set('origins', originAddress);
  url.searchParams.set('destinations', destinationAddress);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('units', 'metric');
  url.searchParams.set('key', apiKey);

  try {
    // POST /api/loads awaits this before responding, and Node's fetch has no
    // default timeout — a slow or hanging Distance Matrix response would
    // otherwise stall the load-posting request (and hold a worker) until the
    // client gives up. A timeout here just falls through to the null return,
    // exactly like an unroutable address.
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const payload = await res.json();
    const element = payload?.rows?.[0]?.elements?.[0];

    if (payload.status !== 'OK' || element?.status !== 'OK') {
      console.error('[googleMaps] distance matrix lookup failed', payload.status, element?.status, payload.error_message);
      return null;
    }

    return Math.round(element.distance.value / 1000);
  } catch (err) {
    console.error('[googleMaps] distance matrix request error', err);
    return null;
  }
}
