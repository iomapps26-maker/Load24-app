// Shared badge vocabulary for a trip's lifecycle (bookings.status — spec
// §8), used by both sides of TripHistoryScreen: MyBidRow (a bid the caller
// placed on someone else's load) and MyLoadTripRow (a load the caller
// posted that someone else's bid turned into a trip). Kept in one place so
// the two sides of the same trip — and TripDetailsScreen's own
// BOOKING_STATUS_TKEY — never drift out of sync with each other.
export const BOOKING_STATUS_BADGE = {
  confirmed: { bg: 'bg-blue-100', text: 'text-blue-700', key: 'bookingStatusConfirmed' },
  in_transit: { bg: 'bg-amber-100', text: 'text-amber-700', key: 'bookingStatusInTransit' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', key: 'bookingStatusCompleted' },
  cancelled: { bg: 'bg-slate-200', text: 'text-slate-600', key: 'bookingStatusCancelled' }
};
