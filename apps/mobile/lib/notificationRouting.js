// Routes a notification to the screen its `data` refers to — shared by
// NotificationsScreen.jsx (tapping a row in the in-app list) and
// pushNotifications.js (tapping a system-tray push, which carries the same
// type/data shape — see backend's lib/notify.js). Types with no known
// destination (wallet/withdrawal events) just mark read / open the app to
// wherever it already was.
export function navigateForNotification(navigation, notification) {
  const { type, data } = notification;
  if (type === 'bid_placed' && data?.load_id) return navigation.navigate('SeeBidding', { loadId: data.load_id });
  if ((type === 'bid_approved' || type === 'bid_rejected') && data?.load_id) {
    return navigation.navigate('TripDetails', { loadId: data.load_id });
  }
  if (type.startsWith('wallet') || type.startsWith('withdrawal')) return navigation.navigate('Wallet');
  if (type.startsWith('kyc')) return navigation.navigate('KycVerification');
  // Payout bank-account verify/reject (backend routes/bankAccounts.js) — the
  // Bank Details card lives on the Profile tab.
  if (type.startsWith('bank_account')) return navigation.navigate('Profile');
  // truck_available_nearby is for shippers/transporters/brokers, not the
  // owner — there's no "Find Trucks" browse screen yet to send them to, so
  // it's left unrouted (tap just marks it read / opens to wherever the app
  // already was). truck_verified/truck_availability_offered are the
  // owner's own posting, so those do go to "My Trucks".
  if (type === 'truck_verified' || type === 'truck_availability_offered') return navigation.navigate('TruckDetails');
  // load_available_nearby is the WhatsApp Smart Load Broadcast's in-app
  // twin (see backend's loads.js/truckAvailability.js notifyNearbyLoads/
  // notifyNearbyTruckOwners) — same destination as the WhatsApp deep link's
  // "View Load"/"Bid" buttons (App.jsx), just reached by tapping the
  // notification instead of a WhatsApp message.
  if (type === 'load_available_nearby' && data?.load_id) return navigation.navigate('PlaceBid', { loadId: data.load_id });
}
