// Per-role required document list for KYC. Keys match user_profiles.user_type
// (see db/migrations/001_init.sql); roles not listed here (staff/admin roles)
// have no KYC case at all. Document type slugs are also used as Supabase
// Storage object names and i18n keys on the mobile side — keep them in sync
// with apps/mobile/lib/kycDocuments.js if this list changes.
export const KYC_REQUIRED_DOCUMENTS = {
  driver: ['driving_license', 'aadhaar', 'photo'],
  truck_owner: ['vehicle_rc', 'pan', 'aadhaar', 'insurance', 'bank_proof'],
  transporter: ['gst_certificate', 'pan', 'aadhaar', 'company_registration', 'bank_proof'],
  broker: ['pan', 'aadhaar', 'gst_certificate', 'bank_proof'],
  shipper: ['pan', 'gst_certificate', 'aadhaar', 'company_registration', 'bank_proof']
};
