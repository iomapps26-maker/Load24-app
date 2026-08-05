// Display metadata (label + icon) for each truck document type — mirrors
// apps/mobile/lib/kycDocuments.js, but the set here is fixed (not
// role-driven) so it's sourced from apps/backend/src/lib/truckDocumentTypes.js
// only conceptually, not by importing it (that file is backend-only).
export const TRUCK_DOCUMENT_META = {
  rc: { labelKey: 'docTruckRc', icon: 'file-certificate-outline' },
  permit: { labelKey: 'docTruckPermit', icon: 'file-document-outline' },
  puc: { labelKey: 'docTruckPuc', icon: 'leaf' },
  insurance: { labelKey: 'docInsurance', icon: 'shield-check-outline' },
  photo_front: { labelKey: 'docTruckPhotoFront', icon: 'truck-outline' },
  photo_back: { labelKey: 'docTruckPhotoBack', icon: 'truck-outline' },
  photo_side: { labelKey: 'docTruckPhotoSide', icon: 'truck-outline' }
};
