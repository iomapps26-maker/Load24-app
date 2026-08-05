// Fixed document set for a truck — unlike KYC (kycRequiredDocs.js), this
// doesn't vary by role, so a flat list is enough (no per-role config needed).
// RC has no expiry field per product spec; permit/PUC/insurance do (see
// permit_expiry/puc_expiry/insurance_expiry columns on trucks).
export const TRUCK_DOCUMENT_TYPES = ['rc', 'permit', 'puc', 'insurance', 'photo_front', 'photo_back', 'photo_side'];
