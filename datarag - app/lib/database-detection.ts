// lib/database-detection.ts

// Database keywords configuration
export const DATABASE_KEYWORDS = {
  critical: [
    "flight status", "statut du vol",
    "arrivals", "arrivées",
    "departures", "départs",
    "delay", "retard", "delays", "retards",
    "cancellation", "annulation", "cancelled",
    "schedule", "horaire", "timetable", "programme",
    "today", "aujourd'hui", "now", "maintenant",
    "this week", "cette semaine", "tonight", "ce soir",
    "this morning", "ce matin", "this afternoon", "cet après-midi",
    "flight info", "infos vol",
    "flight information", "informations sur le vol",
    "flight details", "détails du vol",
  ],
  high: [
    "flight", "flights", "vol", "vols",
    "airport", "airports", "aéroport", "aéroports",
    "airline", "airlines", "compagnie",
    "aircraft", "avion", "plane",
    "departure", "départ", "arrival", "arrivée",
    "statistics", "statistiques", "stats",
    "report", "rapport", "analysis", "analyse",
    "performance", "metrics", "métriques",
    "show", "afficher", "display", "liste", "list",
    "get", "fetch", "retrieve", "find", "search", "lookup", "pull",
  ],
  medium: [
    // Tunisia entities
    "tunisia", "tunisie", "tunisian", "tunisien",
    "tunis", "tunis carthage",
    "djerba", "djerba-zarzis",
    "monastir", "habib bourguiba",
    "sfax", "sfax-thyna",
    "enfidha", "enfidha-hammamet",
    "tozeur", "tozeur-nefta",
    "tabarka", "tabarka-ain draham",
    "gafsa", "gafsa-ksar",
    // Airlines/aircraft families
    "tunisair", "nouvelair", "transavia", "air france",
    "lufthansa", "turkish airlines",
    "boeing", "airbus", "atr", "embraer",
  ],
  low: [
    "route", "routes", "itinéraire", "itinéraires",
    "passenger", "passager",
    "cargo", "fret",
  ],

  // Tunisian IATA codes
  iataTN: ["TUN", "DJE", "MIR", "SFA", "NBE", "TOE", "TBJ", "GAF"],

  // Negative signals (airport operations, not in database)
  negativeOps: [
    // Access/transport/parking
    "parking", "stationnement", "tarif parking", "prix parking", "réservation parking",
    "drop-off", "dépose-minute", "pick-up",
    "taxi", "bus", "métro", "train", "navette", "shuttle", "car rental", "location de voiture",
    "plan d'accès", "directions", "map", "plan de l'aéroport",
    // Services/amenities
    "wifi", "wi-fi", "internet", "chargeur", "charging station",
    "lounge", "salon", "vip", "priority pass",
    "duty free", "boutiques", "magasins", "restaurants", "cafés",
    "prayer room", "salle de prière", "smoking area", "espace fumeur",
    "currency exchange", "bureau de change", "atm", "distributeur",
    "hotel", "hôtel", "transit hotel",
    // Baggage/security/immigration
    "baggage", "bagages", "luggage", "valise",
    "baggage allowance", "franchise bagage", "poids bagage",
    "liquids", "objets interdits", "security check", "contrôle de sécurité",
    "customs", "douane", "immigration", "visa", "e-visa", "passeport",
    "lost and found", "objets trouvés", "bagage perdu",
    // Operations not sourced from DB
    "notam", "metar", "taf", "atis", "atc", "frequency", "fréquence tour",
    "runway closure", "fermeture piste", "condition piste",
    "terminal map", "gate information", "numéro de porte",
    // Admin/contacts/jobs
    "contact", "phone", "téléphone", "email", "mail", "hotline",
    "complaint", "réclamation", "customer service", "service client",
    "careers", "recrutement", "emploi", "jobs", "internship", "stage",
    "tender", "appel d'offres", "procurement", "achat",
    // Assistance
    "wheelchair", "assistance", "unaccompanied minor", "mineur non accompagné",
    "pet travel", "animaux", "chiens", "chats",
  ],

  // Technical negatives (to avoid dev chats triggering DB)
  negativeTech: [
    "react", "next.js", "nextjs", "component", "typescript", "javascript",
    "docker", "kubernetes", "api route", "api", "endpoint",
    "power bi", "report builder", "visual", "dax",
    "latex", "overleaf",
    "error", "bug", "fix", "stack trace",
    "query syntax", "schema design", "orm", "prisma",
  ],
} as const;

// Enhanced intent detection patterns
const TIME_WORDS = [
  "time", "what time", "when",
  "heure", "quelle heure", "quand",
  "today", "aujourd'hui", "tomorrow", "demain", "ce soir", "ce matin", "cet après-midi"
];

const RANK_WORDS = [
  "first", "earliest", "next", "last",
  "premier", "première", "prochain", "dernier"
];

const TO_WORDS = ["to", "towards", "vers", "pour", "à", "a"];
const FROM_WORDS = ["from", "depuis", "de", "d'"];

const CITY_HINTS = [
  // Paris cluster
  "paris", "charles de gaulle", "cdg", "orly", "ory", "beauvais", "bva",
  // Tunisia cluster
  "tunis", "tunis carthage", "tunis–carthage", "tunis-carthage", "tun",
  "djerba", "djerba-zarzis", "dje",
  "monastir", "habib bourguiba", "mir",
  "sfax", "sfax-thyna", "sfa",
  "enfidha", "enfidha-hammamet", "nbe",
  "tozeur", "tozeur-nefta", "toe",
  "tabarka", "tabarka-ain draham", "tbj",
  "gafsa", "gafsa-ksar", "gaf",
];

// Regular expressions for intent detection
const TIME_FLIGHT_REGEX: RegExp[] = [
  /\bwhat\s+time\b.*\b(flight|vol)s?\b/i,
  /\b(quelle\s+heure|quand)\b.*\b(vol|flight)s?\b/i,
  /\b(first|earliest|next|last|premier|première|prochain|dernier)\s+(vol|flight)\b/i,
  /\b(vol|flight)\b.*\b(first|earliest|next|last|premier|première|prochain|dernier)\b/i,
];

const OD_REGEX: RegExp[] = [
  /\b(flight|vol)s?\s+(?:.*\s)?\b(to|vers|pour|à|a)\s+([a-zàâçéèêëîïôûùüÿñ\- ]{2,})/i,
  /\b(from|depuis|de)\s+([a-zàâçéèêëîïôûùüÿñ\- ]{2,})\s+(?:.*\s)?\b(flight|vol)s?\b/i,
];

// Weights for scoring
const WEIGHTS = {
  critical: 5,
  high: 3,
  medium: 2,
  low: 1,
  flightNumber: 6,
  dateOrTime: 2,
  iataMatch: 2,
  tableName: 6,
  schemaToken: 4,
  negativeOps: -5,
  negativeTech: -4,
} as const;

const EXTRA_WEIGHTS = {
  timeWord: 3,
  rankWord: 3,
  timeFlightRegex: 6,
  odRegex: 4,
  cityHint: 3,
} as const;

// Table names from schema
const TABLE_NAMES = [
  "fact_flights",
  "dim_airports", "dim_airlines", "dim_aircraft", "dim_dates", "dim_status",
];

// Pattern matching constants
const FLIGHT_NUMBER_RE = /\b([A-Z]{2}|[A-Z]\d)[\s-]?\d{1,4}\b/;
const DATE_RE_ISO = /\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/;
const TIME_RE = /\b([01]?\d|2[0-3])[:h][0-5]\d\b/;

// Utility functions
const normalize = (s: string) =>
  s.toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

// Main scoring function
function scoreMessage(textRaw: string) {
  const reasons: { term: string; category: string; weight: number }[] = [];
  let score = 0;

  const add = (term: string, category: string, weight: number) => {
    reasons.push({ term, category, weight });
    score += weight;
  };

  const text = normalize(textRaw);

  // Check keyword lists
  const checkList = (list: string[], cat: keyof typeof WEIGHTS) => {
    for (const term of list) {
      if (normalize(term) && text.includes(normalize(term))) {
        add(term, cat, WEIGHTS[cat]);
      }
    }
  };

  // Score positive signals
  checkList(DATABASE_KEYWORDS.critical, "critical");
  checkList(DATABASE_KEYWORDS.high, "high");
  checkList(DATABASE_KEYWORDS.medium, "medium");
  checkList(DATABASE_KEYWORDS.low, "low");

  // Check IATA codes
  for (const code of DATABASE_KEYWORDS.iataTN) {
    if (new RegExp(`\\b${code}\\b`, "i").test(textRaw)) {
      add(code, "iataMatch", WEIGHTS.iataMatch);
    }
  }

  // Check patterns
  if (FLIGHT_NUMBER_RE.test(textRaw)) {
    add("flight_number", "flightNumber", WEIGHTS.flightNumber);
  }

  if (DATE_RE_ISO.test(textRaw) || TIME_RE.test(textRaw)) {
    add("date_or_time", "dateOrTime", WEIGHTS.dateOrTime);
  }

  // Check table names
  for (const tableName of TABLE_NAMES) {
    if (text.includes(normalize(tableName))) {
      add(tableName, "tableName", WEIGHTS.tableName);
    }
  }

  if (/\b(dim_|fact_|table|dimension)\w*/i.test(textRaw)) {
    add("schema_token", "schemaToken", WEIGHTS.schemaToken);
  }

  // Enhanced intent detection
  for (const word of TIME_WORDS) {
    if (text.includes(normalize(word))) {
      add(word, "timeWord", EXTRA_WEIGHTS.timeWord);
    }
  }

  for (const word of RANK_WORDS) {
    if (text.includes(normalize(word))) {
      add(word, "rankWord", EXTRA_WEIGHTS.rankWord);
    }
  }

  for (const regex of TIME_FLIGHT_REGEX) {
    if (regex.test(textRaw)) {
      add(regex.source, "timeFlightRegex", EXTRA_WEIGHTS.timeFlightRegex);
    }
  }

  for (const regex of OD_REGEX) {
    if (regex.test(textRaw)) {
      add(regex.source, "odRegex", EXTRA_WEIGHTS.odRegex);
    }
  }

  for (const city of CITY_HINTS) {
    if (text.includes(normalize(city))) {
      add(city, "cityHint", EXTRA_WEIGHTS.cityHint);
    }
  }

  // Check negative signals
  const negativeOpsRegex = [
    /\bmetar\b/i, /\btaf\b/i, /\batis\b/i, /\bnotam\b/i,
    /\b(runway|piste)\b.*\b(status|closure|ferm|condition)\b/i,
    /\b(visa|douane|customs|immigration)\b/i,
    /\b(lounge|vip|priority pass)\b/i,
    /\b(parking|stationnement)\b/i,
    /\b(taxi|bus|navette|shuttle|train|m[ée]tro)\b/i,
    /\b(lost ?and ?found|objets? trouv[ée]s?)\b/i,
    /\b(contact|t[ée]l[ée]phone|email|mail|hotline)\b/i,
    /\b(recruit|recru|careers?|emploi|jobs?|job|stage|internship)\b/i,
  ];

  const checkNegativeList = (list: string[], cat: keyof typeof WEIGHTS) => {
    for (const term of list) {
      if (text.includes(normalize(term))) {
        add(term, cat, WEIGHTS[cat]);
      }
    }
  };

  checkNegativeList(DATABASE_KEYWORDS.negativeOps, "negativeOps");
  checkNegativeList(DATABASE_KEYWORDS.negativeTech, "negativeTech");

  for (const regex of negativeOpsRegex) {
    if (regex.test(textRaw)) {
      add(regex.source, "negativeOps", WEIGHTS.negativeOps);
    }
  }

  const hasFlightNumber = FLIGHT_NUMBER_RE.test(textRaw);
  const hasDomainSignal =
    reasons.some(r => ["critical", "high", "medium", "low", "iataMatch"].includes(r.category)) ||
    hasFlightNumber ||
    reasons.some(r => ["tableName","schemaToken","timeFlightRegex","odRegex","cityHint","timeWord","rankWord"].includes(r.category));

  return { score, reasons, hasDomainSignal, hasFlightNumber };
}

// Main detection function
export const isDatabaseQuery = (message: string): { isDbQuery: boolean; confidence: number } => {
  const { score, reasons, hasDomainSignal, hasFlightNumber } = scoreMessage(message);

  const hasCritical = reasons.some(r => r.category === "critical");
  const hasTimeRegex = reasons.some(r => r.category === "timeFlightRegex");
  const hasOD = reasons.some(r => r.category === "odRegex" || r.category === "cityHint");
  const hasTableRef = reasons.some(r => r.category === "tableName" || r.category === "schemaToken");
  const hasTimeWord = reasons.some(r => r.category === "timeWord" || r.category === "rankWord");
  const negOpsPull = reasons.filter(r => r.category === "negativeOps").reduce((a, r) => a + r.weight, 0);

  // Decision rules
  let isDbQuery =
    hasDomainSignal && (
      hasFlightNumber ||
      hasCritical ||
      hasTimeRegex ||
      (hasTimeWord && reasons.some(r => r.term === "flight" || r.term === "vol")) ||
      (hasOD && hasTimeWord) ||
      (hasOD && score >= 5) ||
      score >= 6
    );

  // Confidence calculation
  let conf = sigmoid(0.55 * (score - 6));
  if (hasFlightNumber) conf = Math.max(conf, 0.92);
  if (hasTimeRegex) conf = Math.max(conf, 0.90);
  if (hasCritical) conf = Math.max(conf, 0.80);
  if (hasTableRef) conf = Math.max(conf, 0.75);
  if (hasOD) conf = Math.max(conf, 0.70);
  if (hasTimeWord) conf = Math.max(conf, 0.65);

  // Suppress if airport-ops negatives dominate without strong schedule signal
  const hasStrongSchedule = hasTimeRegex || (hasTimeWord && (hasOD || reasons.some(r => r.term === "flight" || r.term === "vol")));
  if (!hasStrongSchedule && !hasFlightNumber && !hasCritical && negOpsPull <= -5 && score < 8) {
    isDbQuery = false;
    conf = Math.min(conf, 0.25);
  }

  return { isDbQuery, confidence: Number(conf.toFixed(2)) };
};
