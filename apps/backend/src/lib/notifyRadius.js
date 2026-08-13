// Shared "nearby" radius for the load<->truck notification fan-outs —
// loads.js's notifyNearbyTruckOwners and truckAvailability.js's
// notifyNearbyUsers/notifyNearbyLoads all reach this far in either
// direction. Kept in one place so the two directions can't drift apart.
export const NEARBY_RADIUS_KM = 100;
