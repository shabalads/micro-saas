// src/app/utils/placeholder-values.ts
//
// Text that suppliers put into a cell to say "nothing here", in the languages their feeds come in. Such a value is
// treated exactly like an empty cell: a description that says "popis není k dispozici" must not become a product
// description in the shop. To teach the cleaner another phrase, add it to the right list below (case, accents and
// surrounding punctuation do not matter, so "POPIS NENÍ K DISPOZICI" and "Popis neni k dispozici" are the same entry).

/** Language-independent fillers and the English ones. */
const GENERIC = [
  "n/a", "na", "n.a.", "n/d", "nd", "none", "null", "nil", "undefined", "unknown", "tbd", "tba", "tbc", "empty", "blank", "void",
  "no description", "no description available", "no description provided", "description not available", "description unavailable",
  "not available", "unavailable", "no data", "no info", "no information", "not applicable", "not specified", "not set", "missing",
  "coming soon", "to be announced", "to be determined", "to be confirmed", "see website", "-", "--", "---", "—", "–", ".", "..", "...", "…", "?", "??", "_", "#n/a", "#null", "#null!", "#value!", "#ref!",
];

const CZECH = [
  "popis není k dispozici", "popis neni k dispozici", "popis není dostupný", "popis nedostupný", "popis chybí", "bez popisu", "žádný popis",
  "není k dispozici", "nedostupné", "nedostupný", "neuvedeno", "nevyplněno", "bez údajů", "žádné údaje", "nezadáno", "nelze určit", "nehodí se", "neznámé", "neznámý",
];

const SLOVAK = [
  "popis nie je k dispozícii", "popis nie je dostupný", "popis chýba", "bez popisu", "žiadny popis", "žiadny popis nie je k dispozícii",
  "nie je k dispozícii", "nedostupné", "neuvedené", "nevyplnené", "nezadané", "neznáme",
];

const POLISH = [
  "brak opisu", "brak opisu produktu", "opis niedostępny", "opis produktu niedostępny", "brak", "brak danych", "brak informacji", "nie dotyczy",
  "niedostępne", "niedostępny", "nie podano", "nieznany", "b.d.", "bd", "b/d", "do uzupełnienia",
];

const GERMAN = [
  "keine beschreibung", "keine beschreibung verfügbar", "beschreibung nicht verfügbar", "ohne beschreibung", "nicht verfügbar", "keine angabe", "keine angaben",
  "keine daten", "nicht angegeben", "unbekannt", "k.a.", "ka", "entfällt", "nicht zutreffend",
];

const FRENCH = [
  "pas de description", "aucune description", "sans description", "description non disponible", "description indisponible", "non disponible", "indisponible",
  "aucune donnée", "non renseigné", "non spécifié", "inconnu", "néant", "sans objet",
];

const SPANISH = [
  "sin descripción", "sin descripcion", "descripción no disponible", "descripcion no disponible", "no disponible", "sin datos", "sin información", "no especificado",
  "desconocido", "no aplica", "ninguno",
];

const ITALIAN = [
  "nessuna descrizione", "senza descrizione", "descrizione non disponibile", "non disponibile", "nessun dato", "non specificato", "sconosciuto", "non applicabile",
];

const OTHER = [
  "nincs leírás", "nem elérhető", // Hungarian
  "geen beschrijving", "niet beschikbaar", "onbekend", // Dutch
  "sem descrição", "sem descricao", "descrição não disponível", "não disponível", // Portuguese
  "fără descriere", "indisponibil", // Romanian
  "ingen beskrivning", "ingen beskrivelse", "ikke tilgængelig", "ej tillgänglig", // Swedish, Danish, Norwegian
  "нет описания", "описание отсутствует", "н/д", "нет данных", // Russian
];

/** Lower case, accents removed, tags and entities gone, punctuation and quotes around the phrase dropped, spaces collapsed. */
export function normalizeForPlaceholder(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;| /gi, " ")
    .replace(/&amp;/gi, "&")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^[\s"'`“”‘’«»<>()[\]{}*:;,!]+|[\s"'`“”‘’«»<>()[\]{}*:;,!]+$/g, "")
    .replace(/\s+/g, " ");
}

/** Every phrase, normalized the same way as the cell values it is compared with. */
export const PLACEHOLDER_PHRASES: ReadonlySet<string> = new Set(
  [...GENERIC, ...CZECH, ...SLOVAK, ...POLISH, ...GERMAN, ...FRENCH, ...SPANISH, ...ITALIAN, ...OTHER].map(normalizeForPlaceholder).filter((phrase) => phrase !== ""),
);

/** Runs of dots, dashes or underscores and the like ("....", "-----", "___"), which no list could spell out. */
const FILLER_RE = /^[\s.\-_–—=*#?/\\|~]+$/;

/** True when the cell says "nothing here" (see the lists above). An empty cell is not a placeholder, it is just empty. */
export function isPlaceholderValue(value: string): boolean {
  if (value.trim() === "") return false;
  const normalized = normalizeForPlaceholder(value);
  if (normalized === "") return false; // markup or quotes around nothing: that is empty, not a placeholder
  return PLACEHOLDER_PHRASES.has(normalized) || FILLER_RE.test(normalized);
}
