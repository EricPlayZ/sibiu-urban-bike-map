/** Remapări OSM / note din CSV-urile existente, plus lățimi completate manual. */

export type WidthField =
  | "row_width_m"
  | "carriageway_m"
  | "sidewalk1_m"
  | "sidewalk2_m"
  | "parking1_m"
  | "parking2_m"
  | "free_sidewalk1_m"
  | "free_sidewalk2_m"
  | "bike1_m"
  | "bike2_m"
  | "green1_m"
  | "green2_m";

/** `null` = golește valoarea din sheet. */
export type WidthOverride = Partial<Record<WidthField, number | null>>;

/**
 * Cheie: `fixKey(nume din sheet)` după curățare (* / roman / paranteze).
 * Valoare: numele din CSV / OSM.
 */
export const STREET_RENAMES: Record<string, Record<string, string>> = {
  trei_stejari: {
    costache_negruzzi: "Constantin (Costache) Negruzzi",
    diaconu_coresi: "Diaconul Coressi",
    hegel: "Georg Wilhelm Friedrich Hegel",
    podragul: "Podragu",
  },
  dumbravii: {
    anghel_dimitrie: "Dimitrie Anghel",
    general_traian_mosoiu: "General Mosoiu",
    johan_wolfgang_goethe: "J.W. Goethe",
    vasile_alexandri_1: "Vasile Alecsandri 1",
    vasile_alexandri_2: "Vasile Alecsandri 2",
  },
  lupeni: {
    ciocarliei: "Ciorcarliei",
  },
  lazaret: {
    auguste_treboniu_laurian: "August Treboniu Laurian",
    cezar_boliac: "Cezar Bolliac",
    corneliu_diaconovici: "Doctor Corneliu Diaconovici",
    emile_zola: "Émile Zola",
    icob_bologa: "Iacob Bologa",
    ivan_sergheievici_turghenev: "Turgheniev",
    lamark: "General Jean Maximilien Lamarque",
    plevnei: "Plevna",
    toamnei: "Lebedei",
  },
  strand2: {
    prof_cornel_irimie: "Profesor Cornel Irimie",
    telorman: "Teleorman",
    intrarea_dimitrie_cantemir: "Dimitrie Cantemir",
  },
  terezian: {
    constantin_notara: "Constantin I. Nottara",
    dumitru_bagdazar: "Doctor Dumitru Bagdazar",
    general_balan: "General Grigore Balan",
    ion_pop_reteganul: "Ion Pop Reteganu",
    tiglarilor: "Tiglari",
    bujorului: "Bujorului (nu exista OSM)",
  },
  valea_aurie: {
    cindrelului: "Cindrel",
    fantanele_sibiel: "Fantanele",
    mihaly_theodor: "Theodor Mihaly",
    pictor_nicolae_grigorescu: "Nicolae Grigorescu",
    preot_baca: "Preot Bacca",
  },
  hipodrom: {
    aleea_artiileristilor: "Aleea Artileristilor",
    mihai_viteazu: "Bulevardul Mihai Viteazul",
    culturii: "Culturii (nu exista OSM)",
  },
};

/** Străzi din sheet pe care CSV-ul le-a scos (fără OSM / rând-comentariu / 0-only). */
export const OMIT_STREETS: Record<string, readonly string[]> = {
  trei_stejari: ["fabricii", "ghetariei", "independentei"],
  dumbravii: ["calea_dumbravii_de_la_cimitir_pana_sensul_giratoriu_cu_v_milea"],
};

/**
 * Completări din CSV care nu sunt în spreadsheet (măsurători adăugate la importul manual).
 * `null` = valoarea din sheet e ignorată.
 */
export const WIDTH_OVERRIDES: Record<string, Record<string, WidthOverride>> = {
  trei_stejari: {
    negoi_2: { row_width_m: null },
  },
  dumbravii: {
    calea_dumbravii: { bike1_m: 2.5, bike2_m: 2.5 },
  },
  terezian: {
    arad: { carriageway_m: 5.5 },
  },
  hipodrom: {
    aleea_biruintei: { sidewalk2_m: 1.9 },
  },
};

/** Hipodrom: rândurile fără nicio lățime (planete goale, III/IV încă necompletate) nu ajung în CSV. */
export const DROP_EMPTY_WIDTH_SLUGS = new Set(["hipodrom"]);
