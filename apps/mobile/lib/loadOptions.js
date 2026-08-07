// Single source of truth for the required_truck_type / fuel_type_required
// enums (see Backend/sql/001_init.sql) — shared by PostLoadScreen (posting)
// and FindLoadsScreen/LoadCard (filtering + display) so the two stay in sync.

export const TRUCK_TYPES = [
  'mahindra_pickup', 'tata_407', 'tata_ace', 'chota_hathi', 'four_vehicle_loader',
  'eicher_truck', 'ashok_leyland', 'lcv', 'lgv', 'open_body', 'closed_body',
  'container', 'trailer', 'tanker', 'tipper', 'flatbed', 'car_carrier', 'other'
];

export const FUEL_TYPES = ['diesel', 'cng', 'electric', 'any', 'other'];

export const AXLE_TYPES = ['single_axle', 'multi_axle', 'any', 'other'];

export const BODY_TYPES = ['open', 'closed', 'container', 'any', 'other'];

export const SPECIAL_CONDITIONS = ['fragile', 'hazardous', 'perishable', 'refrigerated', 'oversized'];

export const TRUCK_TYPE_LABELS = {
  en: {
    mahindra_pickup: 'Mahindra Pickup', tata_407: 'Tata 407', tata_ace: 'Tata Ace',
    chota_hathi: 'Chota Hathi', four_vehicle_loader: '4-Wheeler Loader', eicher_truck: 'Eicher Truck',
    ashok_leyland: 'Ashok Leyland', lcv: 'LCV', lgv: 'LGV', open_body: 'Open Body',
    closed_body: 'Closed Body', container: 'Container', trailer: 'Trailer', tanker: 'Tanker',
    tipper: 'Tipper', flatbed: 'Flatbed', car_carrier: 'Car Carrier', other: 'Other'
  },
  hi: {
    mahindra_pickup: 'महिंद्रा पिकअप', tata_407: 'टाटा 407', tata_ace: 'टाटा ऐस',
    chota_hathi: 'छोटा हाथी', four_vehicle_loader: '4-व्हीलर लोडर', eicher_truck: 'आयशर ट्रक',
    ashok_leyland: 'अशोक लेलैंड', lcv: 'LCV', lgv: 'LGV', open_body: 'खुला बॉडी',
    closed_body: 'बंद बॉडी', container: 'कंटेनर', trailer: 'ट्रेलर', tanker: 'टैंकर',
    tipper: 'टिपर', flatbed: 'फ्लैटबेड', car_carrier: 'कार कैरियर', other: 'अन्य'
  }
};

export const FUEL_LABELS = {
  en: { diesel: 'Diesel', cng: 'CNG', electric: 'Electric', any: 'Any', other: 'Other' },
  hi: { diesel: 'डीजल', cng: 'सीएनजी', electric: 'इलेक्ट्रिक', any: 'कोई भी', other: 'अन्य' }
};

export const AXLE_LABELS = {
  en: { single_axle: 'Single Axle', multi_axle: 'Multi Axle', any: 'Any', other: 'Other' },
  hi: { single_axle: 'सिंगल एक्सल', multi_axle: 'मल्टी एक्सल', any: 'कोई भी', other: 'अन्य' }
};

export const BODY_TYPE_LABELS = {
  en: { open: 'Open', closed: 'Closed', container: 'Container', any: 'Any', other: 'Other' },
  hi: { open: 'खुला', closed: 'बंद', container: 'कंटेनर', any: 'कोई भी', other: 'अन्य' }
};

export const SPECIAL_CONDITION_LABELS = {
  en: { fragile: 'Fragile', hazardous: 'Hazardous', perishable: 'Perishable', refrigerated: 'Refrigerated', oversized: 'Oversized' },
  hi: { fragile: 'नाज़ुक', hazardous: 'खतरनाक', perishable: 'जल्दी खराब होने वाला', refrigerated: 'रेफ्रिजरेटेड', oversized: 'ओवरसाइज़्ड' }
};
