// Callsign → airline, and ICAO type code → readable name and wingspan.
// The first three letters of an airline callsign are the airline's ICAO code (SWR14V → Swiss).
// The list favours airlines seen over Switzerland and Europe; unknown codes show the code itself.

export const AIRLINES = {
  // Switzerland
  SWR: 'Swiss', EDW: 'Edelweiss', EZS: 'easyJet Switzerland', OAW: 'Helvetic Airways',
  SAZ: 'Rega', VJT: 'VistaJet',
  // Germany, Austria
  DLH: 'Lufthansa', CLH: 'Lufthansa CityLine', EWG: 'Eurowings', OCN: 'Discover Airlines',
  CFG: 'Condor', TUI: 'TUIfly', GSW: 'Chair Airlines', MBU: 'Marabu', AUA: 'Austrian',
  LDM: 'Lauda Europe', AHO: 'Air Hamburg', GEC: 'Lufthansa Cargo', BOX: 'AeroLogic',
  BCS: 'DHL (EAT Leipzig)', DLA: 'Air Dolomiti',
  // France, Benelux
  AFR: 'Air France', HOP: 'HOP!', TVF: 'Transavia France', KLM: 'KLM', KLC: 'KLM Cityhopper',
  TRA: 'Transavia', BEL: 'Brussels Airlines', JAF: 'TUI fly Belgium', TFL: 'TUI fly Netherlands',
  LGL: 'Luxair', CLX: 'Cargolux', CCM: 'Air Corsica',
  // UK, Ireland
  BAW: 'British Airways', SHT: 'British Airways', CFE: 'BA CityFlyer', VIR: 'Virgin Atlantic',
  EZY: 'easyJet', EJU: 'easyJet Europe', EXS: 'Jet2', TOM: 'TUI Airways', LOG: 'Loganair',
  EIN: 'Aer Lingus', RYR: 'Ryanair', RUK: 'Ryanair UK', MAY: 'Malta Air', RYS: 'Buzz',
  DHK: 'DHL Air UK',
  // Southern Europe
  IBE: 'Iberia', IBS: 'Iberia Express', VLG: 'Vueling', AEA: 'Air Europa', VOE: 'Volotea',
  TAP: 'TAP Air Portugal', ITY: 'ITA Airways', AEE: 'Aegean', OAL: 'Olympic Air',
  KMM: 'KM Malta Airlines', CTN: 'Croatia Airlines', ASL: 'Air Serbia',
  // Northern and Eastern Europe
  SAS: 'SAS', NAX: 'Norwegian', NSZ: 'Norwegian', FIN: 'Finnair', ICE: 'Icelandair',
  BTI: 'airBaltic', LOT: 'LOT Polish', CSA: 'Czech Airlines', TVS: 'Smartwings',
  WZZ: 'Wizz Air', WUK: 'Wizz Air UK', WMT: 'Wizz Air Malta',
  // Turkey, Middle East, Africa
  THY: 'Turkish Airlines', PGT: 'Pegasus', SXS: 'SunExpress', CAI: 'Corendon',
  UAE: 'Emirates', ETD: 'Etihad', QTR: 'Qatar Airways', SVA: 'Saudia', GFA: 'Gulf Air',
  OMA: 'Oman Air', ELY: 'El Al', MEA: 'Middle East Airlines', RJA: 'Royal Jordanian',
  KAC: 'Kuwait Airways', FDB: 'flydubai', ABY: 'Air Arabia', MSR: 'EgyptAir',
  RAM: 'Royal Air Maroc', TAR: 'Tunisair', ETH: 'Ethiopian', KQA: 'Kenya Airways',
  SAA: 'South African',
  // Asia, Pacific
  AIC: 'Air India', SIA: 'Singapore Airlines', CPA: 'Cathay Pacific', CCA: 'Air China',
  CES: 'China Eastern', CSN: 'China Southern', HVN: 'Vietnam Airlines', THA: 'Thai Airways',
  JAL: 'Japan Airlines', ANA: 'ANA', KAL: 'Korean Air', AAR: 'Asiana', QFA: 'Qantas',
  ANZ: 'Air New Zealand',
  // Americas
  UAL: 'United', AAL: 'American', DAL: 'Delta', ACA: 'Air Canada', WJA: 'WestJet',
  TSC: 'Air Transat', LAN: 'LATAM', TAM: 'LATAM Brasil', AVA: 'Avianca', CMP: 'Copa',
  FDX: 'FedEx', UPS: 'UPS', CKS: 'Kalitta Air',
  // Business jets
  NJE: 'NetJets Europe', EJA: 'NetJets',
};

// Type code → [name, wingspan in m].
export const TYPES = {
  A319: ['A319', 35.8], A320: ['A320', 35.8], A321: ['A321', 35.8], A19N: ['A319neo', 35.8],
  A20N: ['A320neo', 35.8], A21N: ['A321neo', 35.8], BCS1: ['A220-100', 35.1], BCS3: ['A220-300', 35.1],
  A332: ['A330-200', 60.3], A333: ['A330-300', 60.3], A339: ['A330-900', 64.0], A343: ['A340-300', 60.3],
  A346: ['A340-600', 63.5], A359: ['A350-900', 64.8], A35K: ['A350-1000', 64.8], A388: ['A380', 79.8],
  B737: ['737-700', 35.8], B738: ['737-800', 35.8], B739: ['737-900', 35.8],
  B38M: ['737 MAX 8', 35.9], B39M: ['737 MAX 9', 35.9], B752: ['757-200', 38.1], B763: ['767-300', 47.6],
  B772: ['777-200', 60.9], B77L: ['777-200LR', 64.8], B77W: ['777-300ER', 64.8], B744: ['747-400', 64.4],
  B748: ['747-8', 68.4], B788: ['787-8', 60.1], B789: ['787-9', 60.1], B78X: ['787-10', 60.1],
  E190: ['E190', 28.7], E195: ['E195', 28.7], E290: ['E190-E2', 33.7], E295: ['E195-E2', 35.1],
  CRJ9: ['CRJ-900', 24.9], DH8D: ['Dash 8-400', 28.4], AT75: ['ATR 72-500', 27.1], AT76: ['ATR 72-600', 27.1],
  C172: ['Cessna 172', 11.0], C208: ['Cessna Caravan', 15.9], PC12: ['Pilatus PC-12', 16.3],
  PC24: ['Pilatus PC-24', 17.0], DA40: ['Diamond DA40', 11.9], EC35: ['H135', 10.2], EC45: ['H145', 11.0],
};

// ADS-B emitter category → typical wingspan when the type is unknown.
const CATEGORY_SPAN = { A1: 11, A2: 18, A3: 35, A4: 38, A5: 62, A6: 10, A7: 11, B1: 15, B2: 10 };

/** Parse a callsign into airline and flight number, e.g. "SWR14V " → Swiss 14V. */
export function airlineOf(callsign) {
  const cs = (callsign || '').trim().toUpperCase();
  const m = /^([A-Z]{3})(\d[0-9A-Z]{0,3})$/.exec(cs);
  if (!m) return { name: null, code: null, flight: cs || null };
  return { name: AIRLINES[m[1]] || null, code: m[1], flight: m[2] };
}

export function typeName(code) {
  return (code && TYPES[code]?.[0]) || code || null;
}

/** Wingspan in m from the type code, else from the emitter category, else an airliner. */
export function wingspan(code, category) {
  return (code && TYPES[code]?.[1]) || CATEGORY_SPAN[category] || 35;
}

/** Main label line: "Swiss 14V", "SWR 14V" (unknown airline), or the registration for private flights. */
export function title(ac) {
  const a = airlineOf(ac.callsign);
  if (a.name) return `${a.name} ${a.flight}`;
  if (a.code) return `${a.code} ${a.flight}`;
  return a.flight || ac.reg || ac.hex.toUpperCase();
}
