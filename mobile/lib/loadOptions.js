// Single source of truth for the required_truck_type / fuel_type_required
// enums (see Backend/sql/001_init.sql) — shared by PostLoadScreen (posting)
// and FindLoadsScreen/LoadCard (filtering + display) so the two stay in sync.

export const TRUCK_TYPES = [
  'mahindra_pickup', 'tata_407', 'tata_ace', 'chota_hathi', 'four_vehicle_loader',
  'eicher_truck', 'ashok_leyland', 'lcv', 'lgv', 'open_body', 'closed_body',
  'container', 'trailer', 'tanker', 'tipper', 'flatbed', 'car_carrier'
];

export const FUEL_TYPES = ['diesel', 'cng', 'electric', 'any'];

export const TRUCK_TYPE_LABELS = {
  en: {
    mahindra_pickup: 'Mahindra Pickup', tata_407: 'Tata 407', tata_ace: 'Tata Ace',
    chota_hathi: 'Chota Hathi', four_vehicle_loader: '4-Wheeler Loader', eicher_truck: 'Eicher Truck',
    ashok_leyland: 'Ashok Leyland', lcv: 'LCV', lgv: 'LGV', open_body: 'Open Body',
    closed_body: 'Closed Body', container: 'Container', trailer: 'Trailer', tanker: 'Tanker',
    tipper: 'Tipper', flatbed: 'Flatbed', car_carrier: 'Car Carrier'
  },
  hi: {
    mahindra_pickup: 'महिंद्रा पिकअप', tata_407: 'टाटा 407', tata_ace: 'टाटा ऐस',
    chota_hathi: 'छोटा हाथी', four_vehicle_loader: '4-व्हीलर लोडर', eicher_truck: 'आयशर ट्रक',
    ashok_leyland: 'अशोक लेलैंड', lcv: 'LCV', lgv: 'LGV', open_body: 'खुला बॉडी',
    closed_body: 'बंद बॉडी', container: 'कंटेनर', trailer: 'ट्रेलर', tanker: 'टैंकर',
    tipper: 'टिपर', flatbed: 'फ्लैटबेड', car_carrier: 'कार कैरियर'
  }
};

export const FUEL_LABELS = {
  en: { diesel: 'Diesel', cng: 'CNG', electric: 'Electric', any: 'Any' },
  hi: { diesel: 'डीजल', cng: 'सीएनजी', electric: 'इलेक्ट्रिक', any: 'कोई भी' }
};
