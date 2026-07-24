// Accepts "9876543210", "09876543210", "+919876543210", "919876543210" and
// normalizes to E.164 (+91XXXXXXXXXX). India-only for now, same market the
// rest of the app (pincodes, IFSC codes) already assumes. Indian mobile
// numbers always start with 6-9.
export function normalizeIndianPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length !== 10 || !/^[6-9]/.test(last10)) return null;
  return `+91${last10}`;
}
