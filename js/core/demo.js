// Ukázková data (host bez účtu, ?demo=1) — jen v paměti, nic se neukládá.
import { DEFAULT_CATS } from './util.js';

export function demoData() {
  const now = Date.now(), day = 86400000;
  return {
    categories: [...DEFAULT_CATS, 'Mořské plody'],
    catStyles: {
      'Polévky': { color: 3, emoji: '🍲' },
      'Hlavní jídla': { color: 5, emoji: '🍽️' },
      'Dezerty': { color: 6, emoji: '🍰' },
      'Mořské plody': { color: 4, emoji: '🦪' },
    },
    profiles: ['Lukáš', 'Eva', 'Petr'],   // první = „já"
    groups: [],
    activeGroup: null,
    recipes: [
    {
      id: 'demo1', name: 'Hovězí guláš', category: 'Hlavní jídla', author: 'Petr',
      cookTime: 150, portions: 4, photo: '',
      ingredients: [
        { qty: '800', unit: 'g', name: 'hovězí kližka' },
        { qty: '4', unit: 'počet', name: 'velké cibule' },
        { qty: '2', unit: 'lžíce', name: 'sladká paprika' },
        { qty: '1', unit: 'lžička', name: 'majoránka' },
        { qty: '500', unit: 'ml', name: 'hovězí vývar' },
      ],
      steps: ['Cibuli nakrájej nadrobno a zpěň dozlatova.', 'Přidej maso a zprudka orestuj.', 'Zapraš paprikou, zalij vývarem a duš doměkka 2 hodiny.', 'Dochuť majoránkou, česnekem a solí.'],
      reviews: [
        { id: 'rv1', author: 'Eva', stars: 5, comment: 'Nejlepší guláš, jaký znám!', createdAt: now - 9 * day },
        { id: 'rv2', author: 'Lukáš', stars: 4.5, comment: 'Příště trochu pálivější.', createdAt: now - 3 * day },
      ],
      createdAt: now - 40 * day, updatedAt: now - 3 * day,
    },
    {
      id: 'demo2', name: 'Kuřecí polévka s nudlemi', category: 'Polévky', author: 'Eva',
      cookTime: 45, portions: 6, photo: '',
      ingredients: [
        { qty: '1', unit: 'počet', name: 'kuřecí skelet' },
        { qty: '3', unit: 'počet', name: 'mrkve' },
        { qty: '100', unit: 'g', name: 'nudle' },
      ],
      steps: ['Skelet zalij vodou a vař 30 minut.', 'Přidej zeleninu.', 'Sceď, přidej nudle a maso.'],
      reviews: [{ id: 'rv3', author: 'Petr', stars: 4, comment: '', createdAt: now - day }],
      createdAt: now - 10 * day,
    },
    {
      id: 'demo3', name: 'Palačinky', category: 'Dezerty', author: 'Lukáš',
      cookTime: 25, portions: 2, photo: '',
      ingredients: [
        { qty: '250', unit: 'g', name: 'hladká mouka' },
        { qty: '500', unit: 'ml', name: 'mléko' },
        { qty: '2', unit: 'počet', name: 'vejce' },
        { qty: '1', unit: '—', name: 'špetka soli' },
      ],
      steps: ['Umíchej těsto bez hrudek.', 'Smaž z obou stran dozlatova.', 'Namaž marmeládou a sroluj.'],
      reviews: [],
      createdAt: now - 2 * day,
    },
    {
      // ukázka receptu ve víc kategoriích: patří pod Polévky i Mořské plody
      id: 'demo4', name: 'Polévka z mušlí', categories: ['Polévky', 'Mořské plody'], author: 'Eva',
      cookTime: 40, portions: 4, photo: '',
      ingredients: [
        { qty: '1', unit: 'kg', name: 'mušle' },
        { qty: '2', unit: 'lžíce', name: 'máslo' },
        { qty: '200', unit: 'ml', name: 'bílé víno' },
        { qty: '200', unit: 'ml', name: 'smetana' },
        { qty: '2', unit: 'počet', name: 'stroužky česneku' },
      ],
      steps: ['Mušle důkladně omyj a odstraň vousky.', 'Na másle orestuj česnek, zalij vínem a přiveď k varu.', 'Přidej mušle, poklop a duš 5 minut, dokud se neotevřou.', 'Vmíchej smetanu a dochuť.'],
      reviews: [{ id: 'rv4', author: 'Petr', stars: 5, comment: 'Chuť jako u moře.', createdAt: now - 5 * day }],
      createdAt: now - 5 * day,
    },
    ],
  };
}
