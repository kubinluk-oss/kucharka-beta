// Čisté pomocné funkce — bez závislostí na DOM i Firebase.

export const UNITS = ['—', 'počet', 'g', 'kg', 'ml', 'l', 'lžička', 'lžíce'];
export const DEFAULT_CATS = ['Polévky', 'Hlavní jídla', 'Přílohy', 'Dezerty', 'Snídaně', 'Bezmasá jídla', 'Salátky', 'Nápoje'];

/* ================= Nákupní seznam: řazení podle kategorií v obchodě ================= */
// Kategorie v pořadí, jak se běžně prochází obchod (maso k masu, mléčné k mléčným…).
// „ostatni" je koš na položky, které se nepodařilo zařadit — dají se přetáhnout jinam.
export const STORE_CATEGORIES = [
  { key: 'ovoce-zelenina', label: 'Ovoce a zelenina' },
  { key: 'pecivo',         label: 'Pečivo' },
  { key: 'maso-ryby',      label: 'Maso, ryby a uzeniny' },
  { key: 'mlecne',         label: 'Mléčné výrobky a vejce' },
  { key: 'trvanlive',      label: 'Trvanlivé a koření' },
  { key: 'mrazene',        label: 'Mražené' },
  { key: 'napoje',         label: 'Nápoje' },
  { key: 'sladke-slane',   label: 'Sladké a slané' },
  { key: 'drogerie',       label: 'Drogerie a domácnost' },
  { key: 'ostatni',        label: 'Ostatní' },
];

// Slovník normalizovaných kmenů (bez diakritiky, malá písmena). Match = kmen je
// podřetězcem názvu položky, takže chytí i skloňování/množné číslo (cibule/cibuli…).
// Pořadí kategorií = pořadí kontroly; specifičtější/jednoznačnější drž výš.
const STORE_KEYWORDS = {
  'ovoce-zelenina': [
    // zelenina
    'cibul', 'salotk', 'cesnek', 'mrkv', 'mrkev', 'brambor', 'rajc', 'rajce', 'paprik', 'feferonk',
    'okurk', 'salat', 'spenat', 'brokolic', 'kvetak', 'zeli', 'kapust', 'celer', 'petrzel',
    'porek', 'por ', 'redkv', 'redkev', 'dyn', 'cuket', 'cukin', 'lilek', 'avokad', 'zampion',
    'hliv', 'houb', 'hrasek', 'hrach ', 'fazolk', 'kukuric', 'batat', 'repa', 'kedlub',
    'chrest', 'ruzick', 'topinambur', 'pastinak', 'turin', 'rebarbor',
    // ovoce
    'jabl', 'banan', 'pomeranc', 'mandarink', 'klement', 'citron', 'limet', 'limetk', 'grep',
    'grapefruit', 'hrozn', 'jahod', 'malin', 'boruvk', 'ostruzin', 'ribez', 'angrest', 'hrusk',
    'svestk', 'merunk', 'broskv', 'nektarink', 'ananas', 'mango', 'kiwi', 'meloun', 'granat',
    'fik', 'datl', 'brusink', 'kokos ', 'papaj', 'lici', 'mandarin',
    // čerstvé bylinky a ostatní
    'zazvor', 'chilli', 'bazalk', 'petrzelk', 'koriandr', 'pazitk', 'kopr', 'tymian',
    'rozmaryn', 'salvej', 'mata ', 'listov salat', 'ledov salat', 'rukol', 'polnicek',
    'klick', 'nat ', 'natov', 'kres',
  ],
  'pecivo': [
    'chleb', 'chleba', 'rohlik', 'housk', 'baget', 'peciv', 'toust', 'toast', 'kaiser',
    'veka', 'dalamank', 'bulk', 'bulc', 'zeml', 'strouhank', 'tortill', 'lavash', 'wrap ',
    'pita', 'knedlik', 'croissant', 'loupak', 'preclik', 'vanock', 'mazanec', 'bageck',
    'kaiserk', 'grahamov',
  ],
  'maso-ryby': [
    'maso', 'hovez', 'veprov', 'kurec', 'kure', 'krut', 'kachn', 'husa', 'kralic', 'mlet',
    'klobas', 'parek', 'parky', 'spekacek', 'slanin', 'sunk', 'salam', 'uzen', 'uzenin',
    'debrecin', 'jatra', 'jelito', 'jitrnic', 'pastik', 'mortadel', 'kabanos', 'cabajk',
    'bucek', 'ryb', 'losos', 'treska', 'tunak', 'file', 'filet', 'makrel', 'sardin',
    'pstruh', 'kapr', 'krevet', 'musle', 'kalamar', 'sepie', 'kridl', 'stehn', 'prsa ',
    'prsi ', 'kotlet', 'kliz', 'zebr', 'roston', 'svickov', 'panenk', 'plec', 'bok ',
    'gyros', 'karbanat', 'rizek', 'spiz', 'tatarak', 'vnitrn',
  ],
  'mlecne': [
    'mlek', 'mleko', 'maslo', 'maslem', 'smetan', 'slehack', 'jogurt', 'tvaroh', 'syr',
    'syrov', 'eidam', 'gouda', 'niva', 'hermelin', 'mozzarell', 'parmez', 'parmazan',
    'ricott', 'mascarpone', 'cottage', 'zerv', 'balkan', 'feta', 'podmasl', 'kefir',
    'acidk', 'zakysan', 'creme fraiche', 'vejce', 'vejc', 'vajec', 'zloutek', 'bilek',
    'margarin', 'rama ', 'lucin', 'ghi ', 'plnotucn', 'polotucn', 'taven syr', 'plisnov syr',
  ],
  'trvanlive': [
    // sypké
    'mouk', 'cukr', 'mouckov', 'krupic', 'kryst', 'sul ', 'soli', 'ryze', 'ryzov',
    'testovin', 'spaget', 'penne', 'fusilli', 'nudl', 'noky ', 'kuskus', 'bulgur', 'kroup',
    'ovesn', 'vlock', 'musli', 'granol', 'luste', 'cock', 'fazol', 'cizrn', 'pohank', 'jahly',
    // oleje a octy, dochucovadla
    'olej', 'olivov', 'slunecnicov', 'repkov', 'ocet', 'octa', 'balsamik', 'kecup', 'kecap',
    'horcic', 'majonez', 'oliv', 'kapar', 'sardel', 'sojov omack', 'worcester', 'tabasco',
    'protlak', 'passata', 'kokosov', 'vyvar', 'bujon', 'kostk', 'zeleninov zaklad',
    // pečení
    'droz', 'kvasnic', 'kypr', 'prasek do peciva', 'jedl sod', 'zelatin', 'skrob', 'puding',
    'vanilk', 'kakao', 'zdobeni', 'kokos strouhan', 'marcipan',
    // sladidla a nátěrky
    'med ', 'medu', 'sirup', 'marmelad', 'dzem', 'povidl', 'arasidov masl', 'tahini',
    // koření
    'pepr', 'kmin', 'skoric', 'muskat', 'kari', 'kurkum', 'oregan', 'majoran', 'tymian susen',
    'bobkov', 'koreni', 'hrebic', 'zira', 'nove koreni', 'chilli prasek', 'susen rajc',
    'susen houb', 'vegeta',
    // konzervy
    'konzerv', 'kompot', 'nakladan', 'sterilovan',
  ],
  'mrazene': [
    'mrazen', 'zmrzlin', 'mrazak', 'rybi prst', 'nanuk', 'led ',
  ],
  'napoje': [
    'mineralk', 'perliv voda', 'perliv', 'neperliv', 'dzus', 'juice', 'stava ', 'limonad',
    'kofol', 'cola', 'kola ', 'tonik', 'kava', 'kavy', 'caj ', 'caje', 'vino ', 'vina ',
    'vinem', 'pivo', 'piva', 'sekt', 'prosecco', 'rum ', 'vodka', 'whisky', 'liker', 'most ',
    'energ',
  ],
  'sladke-slane': [
    'cokolad', 'susenk', 'bonbon', 'chips', 'cips', 'brambur', 'orisk', 'orech', 'mandl',
    'arasid', 'kesu', 'pistac', 'oplatk', 'tycink', 'lentilk',
    'popcorn', 'krekr', 'nutell', 'lizatk', 'zvykack', 'marshmallow', 'zele bonbon',
    'slan tycink', 'preclik slan',
  ],
  'drogerie': [
    'toaletni', 'papir', 'kapesnik', 'ubrousk', 'mydlo', 'sampon', 'sprchov', 'zubni',
    'prasek na pran', 'praci', 'avivaz', 'saponat', 'jar ', 'alobal',
    'pecici papir', 'potravinov foli', 'folie', 'pytle', 'sacky', 'ubrus', 'houbick',
    'cistic', 'wc ', 'baterie', 'sveck', 'vata', 'holic',
  ],
};

/* Přednostní pravidla — kontrolují se DŘÍV než slovník výše, protože ten bere první
   shodu podle pořadí kategorií. Bez nich skončí „sladká paprika" u zeleniny (kvůli
   „paprika"), „mletý kmín" u masa (kvůli „mletý") a „kokosové mléko" u mléčných.
   Platí, když název obsahuje VŠECHNY uvedené kmeny. */
const STORE_PRIORITY = [
  [['paprik', 'mlet'], 'trvanlive'], [['paprik', 'sladk'], 'trvanlive'], [['paprik', 'udo'], 'trvanlive'],
  [['protlak'], 'trvanlive'], [['vyvar'], 'trvanlive'], [['bujon'], 'trvanlive'],
  [['kmin'], 'trvanlive'], [['koreni'], 'trvanlive'], [['susen'], 'trvanlive'],
  [['vlock'], 'trvanlive'], [['kari'], 'trvanlive'], [['kokosov', 'mlek'], 'trvanlive'],
  [['rajc', 'loupan'], 'trvanlive'], [['rajc', 'konzerv'], 'trvanlive'], [['rajc', 'plechov'], 'trvanlive'],
];

// Zařadí název položky do kategorie v obchodě. Nezná-li ji, vrátí 'ostatni'.
export function classifyIngredient(name) {
  const n = ' ' + norm(name) + ' ';
  if (!n.trim()) return 'ostatni';
  const pri = STORE_PRIORITY.find(([stems]) => stems.every(k => n.includes(k)));
  if (pri) return pri[1];
  for (const cat of STORE_CATEGORIES) {
    if (cat.key === 'ostatni') continue;
    const kws = STORE_KEYWORDS[cat.key];
    if (kws && kws.some(k => n.includes(k))) return cat.key;
  }
  return 'ostatni';
}

// Serifový monogram místo ikony — první písmeno názvu (kategorie či receptu).
export function catInitial(name) {
  const s = String(name || '').trim();
  return s ? s[0].toLocaleUpperCase('cs') : '·';
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Normalizace pro hledání: malá písmena, bez diakritiky.
export function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

export function avgRating(reviews) {
  if (!reviews || !reviews.length) return 0;
  return reviews.reduce((s, r) => s + (r.stars || 0), 0) / reviews.length;
}

// "1,5" | "1.5" | "1/2" | "1 1/2" -> číslo; jinak NaN
export function parseQty(q) {
  const s = String(q ?? '').trim().replace(',', '.');
  if (!s) return NaN;
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return +mixed[1] + (+mixed[2] / +mixed[3]);
  const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac && +frac[2] !== 0) return +frac[1] / +frac[2];
  const n = parseFloat(s);
  return isFinite(n) ? n : NaN;
}

// Hezký český zápis množství (max 2 desetinná místa, čárka).
export function formatQty(n) {
  if (!isFinite(n)) return '';
  const r = Math.round(n * 100) / 100;
  return String(r % 1 === 0 ? r : r.toFixed(2).replace(/0$/, '')).replace('.', ',');
}

// Přepočte množství podle násobku porcí; nečíselná množství vrací beze změny.
export function scaleQty(qty, mult) {
  const n = parseQty(qty);
  if (isNaN(n)) return String(qty ?? '');
  return formatQty(n * mult);
}

// Česká množná čísla: plural(3, 'recept', 'recepty', 'receptů') -> „3 recepty"
export function plural(n, one, few, many) {
  const w = n === 1 ? one : (n >= 2 && n <= 4) ? few : many;
  return `${n} ${w}`;
}

export function formatTime(mins) {
  const m = parseInt(mins) || 0;
  if (m <= 0) return '';
  const h = Math.floor(m / 60), r = m % 60;
  if (h && r) return `${h} h ${r} min`;
  if (h) return `${h} h`;
  return `${r} min`;
}

export function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

// Hvězdičky pro zobrazení (podpora půlek): ★★★☆☆ / "★★★½"
export function starsText(v) {
  const full = Math.floor(v + 0.001);
  const half = v - full >= 0.45;
  return '★'.repeat(full) + (half ? '½' : '');
}

// Hledání podle ingrediencí: tokeny (čárkami) vs. recept -> {matched, total}
export function ingredientMatch(recipe, tokens) {
  const ings = (recipe.ingredients || []).map(i => norm(i.name)).filter(Boolean);
  let matched = 0;
  for (const t of tokens) {
    if (ings.some(n => n.includes(t) || t.includes(n))) matched++;
  }
  return { matched, total: tokens.length };
}

// Zmenšení + komprese fotky před uložením (max 1280 px, JPEG).
export function compressImage(file, maxDim = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > maxDim || h > maxDim) {
        const k = maxDim / Math.max(w, h);
        w = Math.round(w * k); h = Math.round(h * k);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Nepodařilo se načíst obrázek')); };
    img.src = url;
  });
}

// Recept může patřit do víc kategorií (pole `categories`). Staré recepty bez tohoto
// pole (z doby před touto funkcí) mají jen `category` — bere se jako kategorie jedna.
export function recipeCategories(r) {
  if (Array.isArray(r.categories) && r.categories.length) return r.categories;
  return r.category ? [r.category] : [];
}

// „200 g", „2 lžíce"… pro ingredienci přepočtenou na porce. `hideCount` vynechá
// jednotku „počet" (v nákupním seznamu je „3 počet" k ničemu).
export function qtyLabel(i, mult, { hideCount = false } = {}) {
  const u = i.unit && i.unit !== '—' && !(hideCount && i.unit === 'počet') ? i.unit : '';
  return [scaleQty(i.qty, mult), u].filter(Boolean).join(' ');
}

// Text „Zeptat se AI" — recept + instrukce, které fungují v libovolném AI asistentovi
// a vedou k praktickým, bezpečným radám, které jídlo nezkazí.
export function aiPromptText(recipe, mult, portions) {
  const ings = (recipe.ingredients || []).filter(i => i.name)
    .map(i => '- ' + [qtyLabel(i, mult), i.name].filter(Boolean).join(' ')).join('\n');
  const steps = (recipe.steps || []).filter(Boolean).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const meta = [];
  const cats = recipeCategories(recipe);
  if (cats.length) meta.push(`Kategorie: ${cats.join(', ')}`);
  if (recipe.cookTime) meta.push(`Doba přípravy: ${formatTime(recipe.cookTime)}`);
  return `Chovej se jako zkušený šéfkuchař a trpělivý rádce pro domácí kuchyni. Níže je recept přesně tak, jak ho vaříme, a pod ním můj dotaz.

Jak mi odpovídej:
- Česky, stručně a prakticky, ať můžu podle tvé rady rovnou vařit.
- Vycházej z tohoto receptu. Neměň ho celý, uprav jen to, na co se ptám, a respektuj charakter jídla.
- U náhrady suroviny uveď přesné množství vůči původnímu, jak náhrada ovlivní chuť a texturu, a pokud je to potřeba, uprav i dotčené kroky postupu (teploty, časy, pořadí).
- Když existuje víc možností, doporuč jednu nejlepší a stručně řekni proč; ostatní zmiň jen jednou větou.
- Ohlídej, aby výsledek dával smysl: pokud by moje zamýšlená úprava jídlo pravděpodobně pokazila, upozorni mě na to a navrhni bezpečnější cestu.
- Dbej na bezpečnost přípravy (dostatečná tepelná úprava masa a vajec, správné skladování). Pokud se jí dotaz týká, řekni to jasně.
- Pokud ti k dobré odpovědi chybí zásadní informace, nejdřív se mě krátce zeptej.

RECEPT: ${recipe.name}
${meta.length ? meta.join('\n') + '\n' : ''}Počet porcí: ${portions}

INGREDIENCE (na ${portions} porcí):
${ings || '(bez seznamu ingrediencí)'}

POSTUP:
${steps || '(bez postupu)'}

MŮJ DOTAZ: `;
}
