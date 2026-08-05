// Per-role required document list for KYC. Keys match user_profiles.user_type
// (see db/migrations/001_init.sql); roles not listed here (staff/admin roles)
// have no KYC case at all. Document type slugs are also used as Supabase
// Storage object names and i18n keys on the mobile side — keep them in sync
// with apps/mobile/lib/kycDocuments.js if this list changes.
// vehicle_rc and insurance used to be required here for vehicle_owner, but
// both are now collected as real documents on the truck itself (see
// TRUCK_DOCUMENT_TYPES in truckDocumentTypes.js) — a person can own several
// trucks, so a single RC/insurance on their KYC case never made sense once
// the Truck section existed to hold per-vehicle documents properly.
export const KYC_REQUIRED_DOCUMENTS = {
  driver: ['driving_license', 'pan', 'aadhaar', 'photo'],
  vehicle_owner: ['pan', 'aadhaar', 'bank_proof', 'vehicle_photo'],
  transporter: ['pan', 'aadhaar', 'bank_proof', 'lr', 'shop_photo'],
  broker: ['pan', 'aadhaar', 'bank_proof', 'lr', 'shop_photo'],
  shipper: ['pan', 'aadhaar', 'bank_proof', 'lr', 'shop_photo']
};

// Document types a role may optionally upload on top of the required set
// above (offered on the KYC screen but not required to complete the case).
// GST certificate and company registration are optional for every role —
// none of them mandate a registered business.
export const KYC_OPTIONAL_DOCUMENTS = {
  broker: ['gst_certificate', 'company_registration'],
  transporter: ['gst_certificate', 'company_registration'],
  shipper: ['gst_certificate', 'company_registration']
};

// Roles that must additionally capture an address + GPS pin (kyc_cases
// .location_* columns, not a document upload — see 011_add_kyc_location.sql).
export const KYC_REQUIRES_LOCATION = ['transporter'];
