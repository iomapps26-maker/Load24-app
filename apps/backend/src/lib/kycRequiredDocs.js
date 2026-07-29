// Per-role required document list for KYC. Keys match user_profiles.user_type
// (see db/migrations/001_init.sql); roles not listed here (staff/admin roles)
// have no KYC case at all. Document type slugs are also used as Supabase
// Storage object names and i18n keys on the mobile side — keep them in sync
// with apps/mobile/lib/kycDocuments.js if this list changes.
export const KYC_REQUIRED_DOCUMENTS = {
  driver: ['driving_license', 'aadhaar', 'photo'],
  vehicle_owner: ['vehicle_rc', 'pan', 'aadhaar', 'insurance', 'bank_proof'],
  transporter: ['gst_certificate', 'pan', 'aadhaar', 'company_registration', 'bank_proof', 'lr', 'shop_photo'],
  broker: ['pan', 'aadhaar', 'bank_proof'],
  shipper: ['pan', 'gst_certificate', 'aadhaar', 'company_registration', 'bank_proof']
};

// Document types a role may optionally upload on top of the required set
// above (offered on the KYC screen but not required to complete the case).
// GST is optional for every role except shipper and transporter, where it
// stays mandatory (see KYC_REQUIRED_DOCUMENTS).
export const KYC_OPTIONAL_DOCUMENTS = {
  broker: ['gst_certificate']
};

// Roles that must additionally capture an address + GPS pin (kyc_cases
// .location_* columns, not a document upload — see 011_add_kyc_location.sql).
export const KYC_REQUIRES_LOCATION = ['transporter'];
