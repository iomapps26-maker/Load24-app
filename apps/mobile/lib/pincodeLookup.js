// India Post's public pincode API — no key required. Used to auto-fill
// city/state from a 6-digit Indian pincode instead of making the user type
// them by hand.
export async function lookupPincode(pincode) {
  const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
  const [result] = await res.json();
  const postOffice = result?.Status === 'Success' ? result.PostOffice?.[0] : null;
  if (!postOffice) return null;
  return { city: postOffice.District, state: postOffice.State };
}
