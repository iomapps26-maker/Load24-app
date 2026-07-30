// Display metadata (label + icon) for each KYC document type. Which types
// are actually required for the signed-in user comes from the backend
// (GET /api/profile/kyc/case -> required_documents), driven by
// apps/backend/src/lib/kycRequiredDocs.js — this file only needs to cover
// every type that config can ever send.
export const KYC_DOCUMENT_META = {
  driving_license: { labelKey: 'docDrivingLicense', icon: 'card-account-details-outline' },
  aadhaar: { labelKey: 'docAadhaar', icon: 'card-account-details-outline' },
  photo: { labelKey: 'docPhoto', icon: 'account-box-outline' },
  vehicle_photo: { labelKey: 'docVehiclePhoto', icon: 'truck-outline' },
  vehicle_rc: { labelKey: 'docVehicleRc', icon: 'truck-outline' },
  pan: { labelKey: 'docPan', icon: 'card-account-details-outline' },
  insurance: { labelKey: 'docInsurance', icon: 'shield-check-outline' },
  bank_proof: { labelKey: 'docBankProof', icon: 'bank-outline' },
  gst_certificate: { labelKey: 'docGstCertificate', icon: 'file-certificate-outline' },
  company_registration: { labelKey: 'docCompanyRegistration', icon: 'office-building-outline' },
  lr: { labelKey: 'docLr', icon: 'file-document-outline' },
  shop_photo: { labelKey: 'docShopPhoto', icon: 'storefront-outline' }
};
