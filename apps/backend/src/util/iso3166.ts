/**
 * GAP #25: ISO-3166-1 alpha-2 land-liste for admin-dropdown.
 *
 * Statisk array (249 land per ISO-3166-1) — ikke lagret i DB (lite,
 * sjelden endret, ingen mutasjoner). Leveres med norske navn (nb-NO),
 * sortert alfabetisk på `nameNo`.
 *
 * Brukes av:
 *   - GET /api/admin/security/countries (risk-country-management UI)
 *
 * Kilde: ISO-3166-1 alpha-2 standardliste. Norske navn følger Standard Norges
 * offisielle land-liste (https://www.iso.no/standard-norge/standardiseringskomite-iso-3166).
 *
 * Vedlikehold: Hvis et nytt ISO-land legges til, oppdater denne lista og
 * legg til testen i tests-filen. Standarden endrer seg sjelden — siste
 * endringer var Sør-Sudan (SS, 2011) og fjerning av Antarktis-territoriene.
 *
 * Sortering: `getCountryList()` returnerer en ny array sortert alfabetisk
 * på `nameNo` med norsk locale-sammenligning (æøå håndteres riktig).
 */

export interface IsoCountry {
  /** ISO-3166-1 alpha-2 kode (2 store bokstaver). */
  code: string;
  /** Norsk navn (BCP 47: nb-NO). */
  nameNo: string;
  /** Engelsk navn (offisielt fra ISO-3166-1). */
  nameEn: string;
}

/**
 * Råliste — IKKE sortert. `getCountryList()` sorterer på utgang.
 *
 * Vedlikeholders-disiplin: legg til nye land i alfabetisk rekkefølge
 * etter engelsk navn for diff-vennlighet. Sortering ved utgang er locale-
 * korrekt for norsk.
 */
const ISO_3166_1_ALPHA_2: readonly IsoCountry[] = [
  { code: "AF", nameNo: "Afghanistan", nameEn: "Afghanistan" },
  { code: "AX", nameNo: "Åland", nameEn: "Åland Islands" },
  { code: "AL", nameNo: "Albania", nameEn: "Albania" },
  { code: "DZ", nameNo: "Algerie", nameEn: "Algeria" },
  { code: "AS", nameNo: "Amerikansk Samoa", nameEn: "American Samoa" },
  { code: "AD", nameNo: "Andorra", nameEn: "Andorra" },
  { code: "AO", nameNo: "Angola", nameEn: "Angola" },
  { code: "AI", nameNo: "Anguilla", nameEn: "Anguilla" },
  { code: "AQ", nameNo: "Antarktis", nameEn: "Antarctica" },
  { code: "AG", nameNo: "Antigua og Barbuda", nameEn: "Antigua and Barbuda" },
  { code: "AR", nameNo: "Argentina", nameEn: "Argentina" },
  { code: "AM", nameNo: "Armenia", nameEn: "Armenia" },
  { code: "AW", nameNo: "Aruba", nameEn: "Aruba" },
  { code: "AU", nameNo: "Australia", nameEn: "Australia" },
  { code: "AT", nameNo: "Østerrike", nameEn: "Austria" },
  { code: "AZ", nameNo: "Aserbajdsjan", nameEn: "Azerbaijan" },
  { code: "BS", nameNo: "Bahamas", nameEn: "Bahamas" },
  { code: "BH", nameNo: "Bahrain", nameEn: "Bahrain" },
  { code: "BD", nameNo: "Bangladesh", nameEn: "Bangladesh" },
  { code: "BB", nameNo: "Barbados", nameEn: "Barbados" },
  { code: "BY", nameNo: "Hviterussland", nameEn: "Belarus" },
  { code: "BE", nameNo: "Belgia", nameEn: "Belgium" },
  { code: "BZ", nameNo: "Belize", nameEn: "Belize" },
  { code: "BJ", nameNo: "Benin", nameEn: "Benin" },
  { code: "BM", nameNo: "Bermuda", nameEn: "Bermuda" },
  { code: "BT", nameNo: "Bhutan", nameEn: "Bhutan" },
  { code: "BO", nameNo: "Bolivia", nameEn: "Bolivia (Plurinational State of)" },
  { code: "BQ", nameNo: "Bonaire, Sint Eustatius og Saba", nameEn: "Bonaire, Sint Eustatius and Saba" },
  { code: "BA", nameNo: "Bosnia-Hercegovina", nameEn: "Bosnia and Herzegovina" },
  { code: "BW", nameNo: "Botswana", nameEn: "Botswana" },
  { code: "BV", nameNo: "Bouvetøya", nameEn: "Bouvet Island" },
  { code: "BR", nameNo: "Brasil", nameEn: "Brazil" },
  { code: "IO", nameNo: "Britiske territorier i Indiahavet", nameEn: "British Indian Ocean Territory" },
  { code: "BN", nameNo: "Brunei", nameEn: "Brunei Darussalam" },
  { code: "BG", nameNo: "Bulgaria", nameEn: "Bulgaria" },
  { code: "BF", nameNo: "Burkina Faso", nameEn: "Burkina Faso" },
  { code: "BI", nameNo: "Burundi", nameEn: "Burundi" },
  { code: "CV", nameNo: "Kapp Verde", nameEn: "Cabo Verde" },
  { code: "KH", nameNo: "Kambodsja", nameEn: "Cambodia" },
  { code: "CM", nameNo: "Kamerun", nameEn: "Cameroon" },
  { code: "CA", nameNo: "Canada", nameEn: "Canada" },
  { code: "KY", nameNo: "Caymanøyene", nameEn: "Cayman Islands" },
  { code: "CF", nameNo: "Den sentralafrikanske republikk", nameEn: "Central African Republic" },
  { code: "TD", nameNo: "Tsjad", nameEn: "Chad" },
  { code: "CL", nameNo: "Chile", nameEn: "Chile" },
  { code: "CN", nameNo: "Kina", nameEn: "China" },
  { code: "CX", nameNo: "Christmasøya", nameEn: "Christmas Island" },
  { code: "CC", nameNo: "Kokosøyene", nameEn: "Cocos (Keeling) Islands" },
  { code: "CO", nameNo: "Colombia", nameEn: "Colombia" },
  { code: "KM", nameNo: "Komorene", nameEn: "Comoros" },
  { code: "CG", nameNo: "Kongo", nameEn: "Congo" },
  { code: "CD", nameNo: "Den demokratiske republikken Kongo", nameEn: "Congo, Democratic Republic of the" },
  { code: "CK", nameNo: "Cookøyene", nameEn: "Cook Islands" },
  { code: "CR", nameNo: "Costa Rica", nameEn: "Costa Rica" },
  { code: "CI", nameNo: "Elfenbenskysten", nameEn: "Côte d'Ivoire" },
  { code: "HR", nameNo: "Kroatia", nameEn: "Croatia" },
  { code: "CU", nameNo: "Cuba", nameEn: "Cuba" },
  { code: "CW", nameNo: "Curaçao", nameEn: "Curaçao" },
  { code: "CY", nameNo: "Kypros", nameEn: "Cyprus" },
  { code: "CZ", nameNo: "Tsjekkia", nameEn: "Czechia" },
  { code: "DK", nameNo: "Danmark", nameEn: "Denmark" },
  { code: "DJ", nameNo: "Djibouti", nameEn: "Djibouti" },
  { code: "DM", nameNo: "Dominica", nameEn: "Dominica" },
  { code: "DO", nameNo: "Den dominikanske republikk", nameEn: "Dominican Republic" },
  { code: "EC", nameNo: "Ecuador", nameEn: "Ecuador" },
  { code: "EG", nameNo: "Egypt", nameEn: "Egypt" },
  { code: "SV", nameNo: "El Salvador", nameEn: "El Salvador" },
  { code: "GQ", nameNo: "Ekvatorial-Guinea", nameEn: "Equatorial Guinea" },
  { code: "ER", nameNo: "Eritrea", nameEn: "Eritrea" },
  { code: "EE", nameNo: "Estland", nameEn: "Estonia" },
  { code: "SZ", nameNo: "Eswatini", nameEn: "Eswatini" },
  { code: "ET", nameNo: "Etiopia", nameEn: "Ethiopia" },
  { code: "FK", nameNo: "Falklandsøyene", nameEn: "Falkland Islands (Malvinas)" },
  { code: "FO", nameNo: "Færøyene", nameEn: "Faroe Islands" },
  { code: "FJ", nameNo: "Fiji", nameEn: "Fiji" },
  { code: "FI", nameNo: "Finland", nameEn: "Finland" },
  { code: "FR", nameNo: "Frankrike", nameEn: "France" },
  { code: "GF", nameNo: "Fransk Guyana", nameEn: "French Guiana" },
  { code: "PF", nameNo: "Fransk Polynesia", nameEn: "French Polynesia" },
  { code: "TF", nameNo: "De franske sørterritorier", nameEn: "French Southern Territories" },
  { code: "GA", nameNo: "Gabon", nameEn: "Gabon" },
  { code: "GM", nameNo: "Gambia", nameEn: "Gambia" },
  { code: "GE", nameNo: "Georgia", nameEn: "Georgia" },
  { code: "DE", nameNo: "Tyskland", nameEn: "Germany" },
  { code: "GH", nameNo: "Ghana", nameEn: "Ghana" },
  { code: "GI", nameNo: "Gibraltar", nameEn: "Gibraltar" },
  { code: "GR", nameNo: "Hellas", nameEn: "Greece" },
  { code: "GL", nameNo: "Grønland", nameEn: "Greenland" },
  { code: "GD", nameNo: "Grenada", nameEn: "Grenada" },
  { code: "GP", nameNo: "Guadeloupe", nameEn: "Guadeloupe" },
  { code: "GU", nameNo: "Guam", nameEn: "Guam" },
  { code: "GT", nameNo: "Guatemala", nameEn: "Guatemala" },
  { code: "GG", nameNo: "Guernsey", nameEn: "Guernsey" },
  { code: "GN", nameNo: "Guinea", nameEn: "Guinea" },
  { code: "GW", nameNo: "Guinea-Bissau", nameEn: "Guinea-Bissau" },
  { code: "GY", nameNo: "Guyana", nameEn: "Guyana" },
  { code: "HT", nameNo: "Haiti", nameEn: "Haiti" },
  { code: "HM", nameNo: "Heard- og McDonaldøyene", nameEn: "Heard Island and McDonald Islands" },
  { code: "VA", nameNo: "Vatikanstaten", nameEn: "Holy See" },
  { code: "HN", nameNo: "Honduras", nameEn: "Honduras" },
  { code: "HK", nameNo: "Hongkong", nameEn: "Hong Kong" },
  { code: "HU", nameNo: "Ungarn", nameEn: "Hungary" },
  { code: "IS", nameNo: "Island", nameEn: "Iceland" },
  { code: "IN", nameNo: "India", nameEn: "India" },
  { code: "ID", nameNo: "Indonesia", nameEn: "Indonesia" },
  { code: "IR", nameNo: "Iran", nameEn: "Iran (Islamic Republic of)" },
  { code: "IQ", nameNo: "Irak", nameEn: "Iraq" },
  { code: "IE", nameNo: "Irland", nameEn: "Ireland" },
  { code: "IM", nameNo: "Man", nameEn: "Isle of Man" },
  { code: "IL", nameNo: "Israel", nameEn: "Israel" },
  { code: "IT", nameNo: "Italia", nameEn: "Italy" },
  { code: "JM", nameNo: "Jamaica", nameEn: "Jamaica" },
  { code: "JP", nameNo: "Japan", nameEn: "Japan" },
  { code: "JE", nameNo: "Jersey", nameEn: "Jersey" },
  { code: "JO", nameNo: "Jordan", nameEn: "Jordan" },
  { code: "KZ", nameNo: "Kasakhstan", nameEn: "Kazakhstan" },
  { code: "KE", nameNo: "Kenya", nameEn: "Kenya" },
  { code: "KI", nameNo: "Kiribati", nameEn: "Kiribati" },
  { code: "KP", nameNo: "Nord-Korea", nameEn: "Korea (Democratic People's Republic of)" },
  { code: "KR", nameNo: "Sør-Korea", nameEn: "Korea, Republic of" },
  { code: "KW", nameNo: "Kuwait", nameEn: "Kuwait" },
  { code: "KG", nameNo: "Kirgisistan", nameEn: "Kyrgyzstan" },
  { code: "LA", nameNo: "Laos", nameEn: "Lao People's Democratic Republic" },
  { code: "LV", nameNo: "Latvia", nameEn: "Latvia" },
  { code: "LB", nameNo: "Libanon", nameEn: "Lebanon" },
  { code: "LS", nameNo: "Lesotho", nameEn: "Lesotho" },
  { code: "LR", nameNo: "Liberia", nameEn: "Liberia" },
  { code: "LY", nameNo: "Libya", nameEn: "Libya" },
  { code: "LI", nameNo: "Liechtenstein", nameEn: "Liechtenstein" },
  { code: "LT", nameNo: "Litauen", nameEn: "Lithuania" },
  { code: "LU", nameNo: "Luxembourg", nameEn: "Luxembourg" },
  { code: "MO", nameNo: "Macao", nameEn: "Macao" },
  { code: "MG", nameNo: "Madagaskar", nameEn: "Madagascar" },
  { code: "MW", nameNo: "Malawi", nameEn: "Malawi" },
  { code: "MY", nameNo: "Malaysia", nameEn: "Malaysia" },
  { code: "MV", nameNo: "Maldivene", nameEn: "Maldives" },
  { code: "ML", nameNo: "Mali", nameEn: "Mali" },
  { code: "MT", nameNo: "Malta", nameEn: "Malta" },
  { code: "MH", nameNo: "Marshalløyene", nameEn: "Marshall Islands" },
  { code: "MQ", nameNo: "Martinique", nameEn: "Martinique" },
  { code: "MR", nameNo: "Mauritania", nameEn: "Mauritania" },
  { code: "MU", nameNo: "Mauritius", nameEn: "Mauritius" },
  { code: "YT", nameNo: "Mayotte", nameEn: "Mayotte" },
  { code: "MX", nameNo: "Mexico", nameEn: "Mexico" },
  { code: "FM", nameNo: "Mikronesiaføderasjonen", nameEn: "Micronesia (Federated States of)" },
  { code: "MD", nameNo: "Moldova", nameEn: "Moldova, Republic of" },
  { code: "MC", nameNo: "Monaco", nameEn: "Monaco" },
  { code: "MN", nameNo: "Mongolia", nameEn: "Mongolia" },
  { code: "ME", nameNo: "Montenegro", nameEn: "Montenegro" },
  { code: "MS", nameNo: "Montserrat", nameEn: "Montserrat" },
  { code: "MA", nameNo: "Marokko", nameEn: "Morocco" },
  { code: "MZ", nameNo: "Mosambik", nameEn: "Mozambique" },
  { code: "MM", nameNo: "Myanmar", nameEn: "Myanmar" },
  { code: "NA", nameNo: "Namibia", nameEn: "Namibia" },
  { code: "NR", nameNo: "Nauru", nameEn: "Nauru" },
  { code: "NP", nameNo: "Nepal", nameEn: "Nepal" },
  { code: "NL", nameNo: "Nederland", nameEn: "Netherlands" },
  { code: "NC", nameNo: "Ny-Caledonia", nameEn: "New Caledonia" },
  { code: "NZ", nameNo: "New Zealand", nameEn: "New Zealand" },
  { code: "NI", nameNo: "Nicaragua", nameEn: "Nicaragua" },
  { code: "NE", nameNo: "Niger", nameEn: "Niger" },
  { code: "NG", nameNo: "Nigeria", nameEn: "Nigeria" },
  { code: "NU", nameNo: "Niue", nameEn: "Niue" },
  { code: "NF", nameNo: "Norfolkøya", nameEn: "Norfolk Island" },
  { code: "MK", nameNo: "Nord-Makedonia", nameEn: "North Macedonia" },
  { code: "MP", nameNo: "Nord-Marianene", nameEn: "Northern Mariana Islands" },
  { code: "NO", nameNo: "Norge", nameEn: "Norway" },
  { code: "OM", nameNo: "Oman", nameEn: "Oman" },
  { code: "PK", nameNo: "Pakistan", nameEn: "Pakistan" },
  { code: "PW", nameNo: "Palau", nameEn: "Palau" },
  { code: "PS", nameNo: "Palestina", nameEn: "Palestine, State of" },
  { code: "PA", nameNo: "Panama", nameEn: "Panama" },
  { code: "PG", nameNo: "Papua Ny-Guinea", nameEn: "Papua New Guinea" },
  { code: "PY", nameNo: "Paraguay", nameEn: "Paraguay" },
  { code: "PE", nameNo: "Peru", nameEn: "Peru" },
  { code: "PH", nameNo: "Filippinene", nameEn: "Philippines" },
  { code: "PN", nameNo: "Pitcairn", nameEn: "Pitcairn" },
  { code: "PL", nameNo: "Polen", nameEn: "Poland" },
  { code: "PT", nameNo: "Portugal", nameEn: "Portugal" },
  { code: "PR", nameNo: "Puerto Rico", nameEn: "Puerto Rico" },
  { code: "QA", nameNo: "Qatar", nameEn: "Qatar" },
  { code: "RE", nameNo: "Réunion", nameEn: "Réunion" },
  { code: "RO", nameNo: "Romania", nameEn: "Romania" },
  { code: "RU", nameNo: "Russland", nameEn: "Russian Federation" },
  { code: "RW", nameNo: "Rwanda", nameEn: "Rwanda" },
  { code: "BL", nameNo: "Saint-Barthélemy", nameEn: "Saint Barthélemy" },
  { code: "SH", nameNo: "Saint Helena", nameEn: "Saint Helena, Ascension and Tristan da Cunha" },
  { code: "KN", nameNo: "Saint Kitts og Nevis", nameEn: "Saint Kitts and Nevis" },
  { code: "LC", nameNo: "Saint Lucia", nameEn: "Saint Lucia" },
  { code: "MF", nameNo: "Saint-Martin (fransk)", nameEn: "Saint Martin (French part)" },
  { code: "PM", nameNo: "Saint-Pierre og Miquelon", nameEn: "Saint Pierre and Miquelon" },
  { code: "VC", nameNo: "Saint Vincent og Grenadinene", nameEn: "Saint Vincent and the Grenadines" },
  { code: "WS", nameNo: "Samoa", nameEn: "Samoa" },
  { code: "SM", nameNo: "San Marino", nameEn: "San Marino" },
  { code: "ST", nameNo: "São Tomé og Príncipe", nameEn: "Sao Tome and Principe" },
  { code: "SA", nameNo: "Saudi-Arabia", nameEn: "Saudi Arabia" },
  { code: "SN", nameNo: "Senegal", nameEn: "Senegal" },
  { code: "RS", nameNo: "Serbia", nameEn: "Serbia" },
  { code: "SC", nameNo: "Seychellene", nameEn: "Seychelles" },
  { code: "SL", nameNo: "Sierra Leone", nameEn: "Sierra Leone" },
  { code: "SG", nameNo: "Singapore", nameEn: "Singapore" },
  { code: "SX", nameNo: "Sint Maarten (nederlandsk)", nameEn: "Sint Maarten (Dutch part)" },
  { code: "SK", nameNo: "Slovakia", nameEn: "Slovakia" },
  { code: "SI", nameNo: "Slovenia", nameEn: "Slovenia" },
  { code: "SB", nameNo: "Salomonøyene", nameEn: "Solomon Islands" },
  { code: "SO", nameNo: "Somalia", nameEn: "Somalia" },
  { code: "ZA", nameNo: "Sør-Afrika", nameEn: "South Africa" },
  { code: "GS", nameNo: "Sør-Georgia og Sør-Sandwichøyene", nameEn: "South Georgia and the South Sandwich Islands" },
  { code: "SS", nameNo: "Sør-Sudan", nameEn: "South Sudan" },
  { code: "ES", nameNo: "Spania", nameEn: "Spain" },
  { code: "LK", nameNo: "Sri Lanka", nameEn: "Sri Lanka" },
  { code: "SD", nameNo: "Sudan", nameEn: "Sudan" },
  { code: "SR", nameNo: "Surinam", nameEn: "Suriname" },
  { code: "SJ", nameNo: "Svalbard og Jan Mayen", nameEn: "Svalbard and Jan Mayen" },
  { code: "SE", nameNo: "Sverige", nameEn: "Sweden" },
  { code: "CH", nameNo: "Sveits", nameEn: "Switzerland" },
  { code: "SY", nameNo: "Syria", nameEn: "Syrian Arab Republic" },
  { code: "TW", nameNo: "Taiwan", nameEn: "Taiwan, Province of China" },
  { code: "TJ", nameNo: "Tadsjikistan", nameEn: "Tajikistan" },
  { code: "TZ", nameNo: "Tanzania", nameEn: "Tanzania, United Republic of" },
  { code: "TH", nameNo: "Thailand", nameEn: "Thailand" },
  { code: "TL", nameNo: "Øst-Timor", nameEn: "Timor-Leste" },
  { code: "TG", nameNo: "Togo", nameEn: "Togo" },
  { code: "TK", nameNo: "Tokelau", nameEn: "Tokelau" },
  { code: "TO", nameNo: "Tonga", nameEn: "Tonga" },
  { code: "TT", nameNo: "Trinidad og Tobago", nameEn: "Trinidad and Tobago" },
  { code: "TN", nameNo: "Tunisia", nameEn: "Tunisia" },
  { code: "TR", nameNo: "Tyrkia", nameEn: "Türkiye" },
  { code: "TM", nameNo: "Turkmenistan", nameEn: "Turkmenistan" },
  { code: "TC", nameNo: "Turks- og Caicosøyene", nameEn: "Turks and Caicos Islands" },
  { code: "TV", nameNo: "Tuvalu", nameEn: "Tuvalu" },
  { code: "UG", nameNo: "Uganda", nameEn: "Uganda" },
  { code: "UA", nameNo: "Ukraina", nameEn: "Ukraine" },
  { code: "AE", nameNo: "De forente arabiske emirater", nameEn: "United Arab Emirates" },
  { code: "GB", nameNo: "Storbritannia", nameEn: "United Kingdom of Great Britain and Northern Ireland" },
  { code: "US", nameNo: "USA", nameEn: "United States of America" },
  { code: "UM", nameNo: "USAs ytre småøyer", nameEn: "United States Minor Outlying Islands" },
  { code: "UY", nameNo: "Uruguay", nameEn: "Uruguay" },
  { code: "UZ", nameNo: "Usbekistan", nameEn: "Uzbekistan" },
  { code: "VU", nameNo: "Vanuatu", nameEn: "Vanuatu" },
  { code: "VE", nameNo: "Venezuela", nameEn: "Venezuela (Bolivarian Republic of)" },
  { code: "VN", nameNo: "Vietnam", nameEn: "Viet Nam" },
  { code: "VG", nameNo: "De britiske Jomfruøyene", nameEn: "Virgin Islands (British)" },
  { code: "VI", nameNo: "De amerikanske Jomfruøyene", nameEn: "Virgin Islands (U.S.)" },
  { code: "WF", nameNo: "Wallis og Futuna", nameEn: "Wallis and Futuna" },
  { code: "EH", nameNo: "Vest-Sahara", nameEn: "Western Sahara" },
  { code: "YE", nameNo: "Jemen", nameEn: "Yemen" },
  { code: "ZM", nameNo: "Zambia", nameEn: "Zambia" },
  { code: "ZW", nameNo: "Zimbabwe", nameEn: "Zimbabwe" },
] as const;

/**
 * Norsk locale-collator brukt for å sortere alfabetisk på norske navn
 * (æøå plasseres etter z, å etter ø, etc.).
 */
const NB_COLLATOR = new Intl.Collator("nb-NO", { sensitivity: "base" });

/**
 * Returnerer hele ISO-3166-1 alpha-2 lista, sortert alfabetisk på `nameNo`
 * med norsk locale-sammenligning. Returverdien er en kopi (mutering tillatt
 * for caller — original-liste er frosset).
 *
 * Brukes av admin-UI for risk-country-management dropdown.
 */
export function getCountryList(): IsoCountry[] {
  return [...ISO_3166_1_ALPHA_2].sort((a, b) => NB_COLLATOR.compare(a.nameNo, b.nameNo));
}

/**
 * Slår opp en land-oppføring etter ISO-kode (case-insensitive). Returnerer
 * `undefined` hvis koden ikke finnes.
 */
export function findCountryByCode(code: string): IsoCountry | undefined {
  const upper = code.trim().toUpperCase();
  return ISO_3166_1_ALPHA_2.find((c) => c.code === upper);
}

/**
 * Returnerer en ny Set med alle gyldige ISO-koder. Brukes for fast lookups
 * i validation-paths.
 */
export function getValidCountryCodes(): Set<string> {
  return new Set(ISO_3166_1_ALPHA_2.map((c) => c.code));
}

/** @internal — kun for testing. */
export const _RAW_ISO_LIST: readonly IsoCountry[] = ISO_3166_1_ALPHA_2;
