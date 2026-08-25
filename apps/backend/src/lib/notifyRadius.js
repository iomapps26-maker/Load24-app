// Shared "nearby" radius for the load<->truck notification fan-outs —
// loads.js's notifyNearbyTruckOwners and truckAvailability.js's
// notifyNearbyUsers/notifyNearbyLoads all reach this far in either
// direction. Kept in one place so the two directions can't drift apart.
export const NEARBY_RADIUS_KM = 100;

// How many WhatsApp template sends a single posting event (one new load, or
// one truck going available) is allowed to trigger, in either direction.
// In-app notifications go out to every match — they're free and
// non-intrusive — but WhatsApp is a paid, per-message business-template
// send, so a busy hub with dozens of matches on one event shouldn't turn
// into dozens of WhatsApp messages. Shared by both directions so the cap
// can't drift between them the same way NEARBY_RADIUS_KM doesn't.
export const WHATSAPP_ALERT_CAP = 3;
