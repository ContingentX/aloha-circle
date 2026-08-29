// Curated origin airports: direct-to-OGG routes plus the major international
// hubs travelers connect through. Unknown codes still verify — they just
// default to English until the traveler picks a language.
export const AIRPORTS = {
  // Hawaii inter-island
  HNL: ['Honolulu', 'US'], LIH: ['Lihue', 'US'], KOA: ['Kona', 'US'], ITO: ['Hilo', 'US'],
  // US mainland
  LAX: ['Los Angeles', 'US'], SFO: ['San Francisco', 'US'], SAN: ['San Diego', 'US'],
  SJC: ['San Jose', 'US'], OAK: ['Oakland', 'US'], SMF: ['Sacramento', 'US'],
  SEA: ['Seattle', 'US'], PDX: ['Portland', 'US'], DEN: ['Denver', 'US'],
  PHX: ['Phoenix', 'US'], LAS: ['Las Vegas', 'US'], SLC: ['Salt Lake City', 'US'],
  DFW: ['Dallas', 'US'], ORD: ['Chicago', 'US'], ATL: ['Atlanta', 'US'],
  JFK: ['New York', 'US'], EWR: ['Newark', 'US'], BOS: ['Boston', 'US'], IAD: ['Washington', 'US'],
  // Canada
  YVR: ['Vancouver', 'CA'], YYC: ['Calgary', 'CA'], YYZ: ['Toronto', 'CA'],
  // Japan
  NRT: ['Tokyo Narita', 'JP'], HND: ['Tokyo Haneda', 'JP'], KIX: ['Osaka', 'JP'],
  NGO: ['Nagoya', 'JP'], CTS: ['Sapporo', 'JP'], FUK: ['Fukuoka', 'JP'],
  // Korea, China, Taiwan, Hong Kong
  ICN: ['Seoul', 'KR'], GMP: ['Seoul Gimpo', 'KR'],
  PEK: ['Beijing', 'CN'], PVG: ['Shanghai', 'CN'], HKG: ['Hong Kong', 'HK'], TPE: ['Taipei', 'TW'],
  // Oceania
  SYD: ['Sydney', 'AU'], MEL: ['Melbourne', 'AU'], AKL: ['Auckland', 'NZ'],
  // Europe
  FRA: ['Frankfurt', 'DE'], MUC: ['Munich', 'DE'], BER: ['Berlin', 'DE'],
  CDG: ['Paris', 'FR'], ORY: ['Paris Orly', 'FR'], LHR: ['London', 'GB'], LGW: ['London Gatwick', 'GB'],
  AMS: ['Amsterdam', 'NL'], MAD: ['Madrid', 'ES'], BCN: ['Barcelona', 'ES'], LIS: ['Lisbon', 'PT'],
  // Latin America
  GRU: ['São Paulo', 'BR'], GIG: ['Rio de Janeiro', 'BR'], MEX: ['Mexico City', 'MX'],
};

const COUNTRY_LANG = {
  JP: 'ja', KR: 'ko', CN: 'zh', TW: 'zh', HK: 'zh',
  DE: 'de', AT: 'de', CH: 'de', FR: 'fr',
  ES: 'es', MX: 'es', PT: 'pt', BR: 'pt',
};

// The languages we pre-generate the aloha explainer voices in.
export const LANGUAGES = {
  en: { label: 'English', greeting: 'E komo mai — welcome to the ohana!' },
  ja: { label: '日本語', greeting: 'ようこそ、オハナへ！' },
  ko: { label: '한국어', greeting: '오하나에 오신 것을 환영합니다!' },
  zh: { label: '中文', greeting: '欢迎加入我们的大家庭！' },
  de: { label: 'Deutsch', greeting: 'Willkommen in der Ohana!' },
  fr: { label: 'Français', greeting: "Bienvenue dans l'ohana !" },
  es: { label: 'Español', greeting: '¡Bienvenido a la ohana!' },
  pt: { label: 'Português', greeting: 'Bem-vindo à ohana!' },
};

export const airportCity = (code) => AIRPORTS[code]?.[0] ?? code;
export const airportLang = (code) => COUNTRY_LANG[AIRPORTS[code]?.[1]] ?? 'en';
