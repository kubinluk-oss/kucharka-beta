/* Jádro Kuchařky: data a pravidla, jak appka funguje. Žádné HTML, DOM ani texty
   hlášek — rozhraní čte `state`, poslouchá změny přes on() a volá funkce níže.
   Funkce, které zapisují do cloudu, při chybě VYHAZUJÍ výjimku; co uživateli říct,
   rozhoduje rozhraní.

   Firestore (stejné jako v ostré appce, data jsou sdílená):
     groups/{gid}                 { name, code, ownerUid, members[], memberNames{uid:jméno}, personal }
     groups/{gid}/recipes/{id}    recept (stejné id ve všech skupinách, kde je; `groups` = seznam)
     groups/{gid}/meta/{categories|catStyles|profiles|avatarPhotos|highScores}
     joinCodes/{kód}              { gid }
     shoppingLists/{uid}          { items } — osobní nákupní seznam
     sharedLists/{id}             { ownerUid, members[], memberNames, items } — společný seznam
     recipes/{id}                 původní společná kuchařka (jen staré sdílené odkazy)
   Každý má osobní kuchařku `p_<uid>`. „Moje kuchařka" = souhrn receptů ze všech skupin. */
import {
  db, storage, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch,
  arrayUnion, arrayRemove, deleteField, FieldPath, query, where, runTransaction,
  ref, uploadString, getDownloadURL, deleteObject
} from './firebase.js';
import {
  DEFAULT_CATS, uid, norm, avgRating, ingredientMatch, recipeCategories, qtyLabel, classifyIngredient
} from './util.js';
import { currentUid, currentDisplayName, setDisplayName, refreshTokenIfStale } from './auth.js';
import { demoData } from './demo.js';

/* ================= Stav ================= */
export const state = {
  mode: 'off',          // 'off' | 'live' (přihlášený) | 'demo' (ukázková data v paměti) | 'public' (jeden sdílený recept)
  loaded: false,        // dorazila data aktivní kuchařky
  loadError: '',        // proč se kuchařka nenačetla ('' = v pořádku)
  recipes: [],          // recepty aktivní kuchařky; v souhrnu mají `_gid` (kopie, se kterou se pracuje) a `_gids`
  categories: [],
  catStyles: {},        // { název: { color: 0-8 | '#hex', emoji } }
  avatarPhotos: {},     // { jméno: url }
  profiles: [],         // jména autorů v kuchařce
  highScores: {},       // { jméno: skóre } — minihra
  groups: [],           // moje skupiny (osobní první)
  activeGroup: null,
  myShopping: [],       // můj osobní seznam [{ id, text, cat, done }]
  sharedLists: [],      // společné seznamy, ve kterých jsem
  shopList: 'mine',     // zobrazený seznam: 'mine' | id společného
  shopping: [],         // položky ZOBRAZENÉHO seznamu
};

/* Události pro rozhraní:
   'data'     — recepty/kategorie/profily aktivní kuchařky
   'groups'   — seznam mých skupin
   'shopping' — zobrazený nákupní seznam nebo seznam společných seznamů
   'status'   — loaded/loadError
   'notice'   — zpráva pro uživatele, která nevznikla jeho akcí ({ type, ... }) */
const listeners = {};
export function on(event, fn) {
  (listeners[event] ||= new Set()).add(fn);
  return () => listeners[event].delete(fn);
}
function emit(event, payload) {
  // odloženě: víc změn z jednoho snímku cloudu se slije a rozhraní nepřekresluje uprostřed zápisu
  queueMicrotask(() => (listeners[event] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } }));
}

const live = () => state.mode === 'live';
const demo = () => state.mode === 'demo';

/* ================= Identita a oprávnění ================= */
export function myName() { return demo() ? (state.profiles[0] || 'Ty') : currentDisplayName(); }
export const personalGroupId = () => 'p_' + currentUid();
export const isGroupOwner = g => !!g && g.ownerUid === currentUid();
export const groupById = id => state.groups.find(g => g.id === id) || null;
export const activeGroupObj = () => groupById(state.activeGroup);
export const groupLabel = id => { const g = groupById(id); return g?.personal ? 'Moje kuchařka' : (g?.name || 'Kuchařka'); };

// Recept/hodnocení je moje: podle uid autora, u starých záznamů podle jména.
export function isMine(x) {
  if (!x) return false;
  const me = currentUid();
  if (x.authorUid && me) return x.authorUid === me;
  return !!x.author && x.author === myName();
}

// Ve kterých MÝCH skupinách recept je.
export function recipeGroupsOf(r) {
  const mine = id => state.groups.some(g => g.id === id);
  const list = (r._gids || r.groups || []).filter(mine);
  return list.length ? list : [r._gid || state.activeGroup];
}

/* Upravit/smazat smí autor a správce skupiny — správce jen tehdy, když spravuje všechny
   moje skupiny, kde recept je (úprava i smazání se propisují do všech kopií). */
export function canEditRecipe(r) {
  if (state.mode === 'public' || !r) return false;
  if (isMine(r)) return true;
  return live() && recipeGroupsOf(r).every(gid => isGroupOwner(groupById(gid)));
}
// Mezi kuchařkami recept přesouvá jen autor.
export const canMoveRecipe = r => live() && state.groups.length > 1 && (!r || isMine(r));

// Komu může správce recept přiřadit (členové skupin receptu; prázdné, když je nespravuju všechny).
export function assignableAuthors(r) {
  if (!live() || !r) return [];
  const groups = recipeGroupsOf(r).map(groupById);
  if (groups.some(g => !isGroupOwner(g))) return [];
  const byUid = new Map();
  groups.forEach(g => (g.members || []).forEach(u => {
    if (!byUid.has(u)) byUid.set(u, { uid: u, name: g.memberNames?.[u] || (u === currentUid() ? myName() : 'Člen') });
  }));
  const list = [...byUid.values()].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  return list.length > 1 ? list : [];
}

// Lidé, se kterými můžu sdílet nákupní seznam: členové všech mých skupin kromě mě.
export function shareablePeople() {
  const me = currentUid();
  const people = new Map();
  state.groups.forEach(g => (g.members || []).forEach(u => {
    if (u !== me && !people.has(u)) people.set(u, (g.memberNames || {})[u] || 'Člen');
  }));
  return [...people].map(([uid, name]) => ({ uid, name })).sort((a, b) => a.name.localeCompare(b.name, 'cs'));
}

/* ================= Odběry z cloudu ================= */
let unsubs = [];        // účtové (skupiny, nákup) — dokud jsem přihlášený
let groupUnsubs = [];   // data aktivní kuchařky — ruší se při přepnutí
function listen(target, onNext, onErr, bucket = unsubs) { bucket.push(onSnapshot(target, onNext, onErr)); }
function unsubscribeGroup() { groupUnsubs.forEach(u => u()); groupUnsubs = []; }
function unsubscribeAll() { unsubscribeGroup(); unsubs.forEach(u => u()); unsubs = []; }

function resetState() {
  Object.assign(state, {
    loaded: false, loadError: '', recipes: [], categories: [], catStyles: {}, avatarPhotos: {}, profiles: [],
    highScores: {}, groups: [], activeGroup: null, myShopping: [], sharedLists: [], shopList: 'mine', shopping: [],
  });
}

/* Start po přihlášení (stav 'ready' z watchAuth). `preferGroup` = skupina ze
   sdíleného odkazu — když v ní jsem, otevře se rovnou ona. */
export async function startLive(user, { preferGroup = null } = {}) {
  stop();
  state.mode = 'live';
  await refreshTokenIfStale(user);
  subscribeShopping();
  subscribeGroups(preferGroup);
}

// Ukázková data jen v paměti (nic se neukládá).
export function startDemo() {
  stop();
  state.mode = 'demo';
  Object.assign(state, demoData(), { loaded: true });
  loadShoppingLocal();
  emit('groups'); emit('data'); emit('shopping'); emit('status');
}

// Konec (odhlášení): odběry i data patřily předchozímu účtu.
export function stop() {
  unsubscribeAll();
  clearTimeout(loadTimer);
  resetState();
  state.mode = 'off';
}

/* Když se kuchařka nenačte (zamítnutý přístup, výpadek, dlouhé čekání), nesmí appka
   donekonečna ukazovat načítání — loadError říká proč; retry() zkusí znovu. */
let loadTimer = 0;
function setLoadError(msg) {
  if (state.loaded) return;
  state.loadError = msg;
  emit('status');
}
function setLoaded() {
  state.loaded = true;
  state.loadError = '';
  clearTimeout(loadTimer);
  emit('status');
}
export function retry() {
  if (!live()) return;
  const keep = state.activeGroup;
  unsubscribeAll();
  resetState();
  subscribeShopping();
  subscribeGroups(keep);
}

const groupStoreKey = () => 'kucharka-group-' + currentUid();

async function ensurePersonalGroup() {
  const gref = doc(db, 'groups', personalGroupId());
  if ((await getDoc(gref)).exists()) return;
  await setDoc(gref, {
    name: 'Moje kuchařka', personal: true, ownerUid: currentUid(),
    members: [currentUid()], memberNames: { [currentUid()]: myName() }, createdAt: Date.now(),
  });
}

let aggregateKey = '';
async function subscribeGroups(preferGroup) {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => setLoadError(navigator.onLine
    ? 'Načítání trvá nezvykle dlouho. Zkus to prosím znovu.'
    : 'Jsi offline. Připoj se k internetu a zkus to znovu.'), 15000);
  try { await ensurePersonalGroup(); } catch (e) { console.error('personal group:', e); }
  let first = true;
  listen(query(collection(db, 'groups'), where('members', 'array-contains', currentUid())), snap => {
    state.groups = snap.docs.map(d => ({ ...d.data(), id: d.id }))
      .sort((a, b) => (b.personal ? 1 : 0) - (a.personal ? 1 : 0) || (a.name || '').localeCompare(b.name || '', 'cs'));
    const has = id => id && state.groups.some(g => g.id === id);
    let saved = null;
    try { saved = localStorage.getItem(groupStoreKey()); } catch { /* soukromý režim */ }
    if (!has(state.activeGroup)) {
      if (state.activeGroup && !first) emit('notice', { type: 'removed-from-group' });
      switchGroup(has(preferGroup) ? preferGroup : has(saved) ? saved : personalGroupId());
    } else if (isAggregate() && state.groups.map(g => g.id).join(',') !== aggregateKey) {
      switchGroup(personalGroupId());   // přibyla/ubyla skupina -> souhrn sestavit znovu
    }
    first = false;
    emit('groups');
  }, err => {
    console.error('groups sync:', err);
    setLoadError(err.code === 'permission-denied'
      ? 'Firebase odmítl přístup k tvému účtu. Zkus se odhlásit a znovu přihlásit.'
      : 'Nepodařilo se spojit s cloudem. Zkontroluj připojení k internetu.');
  });
}

// „Moje kuchařka" (osobní) = souhrn ze všech skupin.
export const isAggregate = () => live() && !!state.activeGroup && state.activeGroup === personalGroupId();

// Přepne na data jiné kuchařky; vše z předchozí se zahodí.
export function switchGroup(gid) {
  if (!gid || !live()) return;
  unsubscribeGroup();
  state.activeGroup = gid;
  try { localStorage.setItem(groupStoreKey(), gid); } catch { /* soukromý režim */ }
  Object.assign(state, { recipes: [], categories: [], catStyles: {}, avatarPhotos: {}, profiles: [], highScores: {}, loaded: false });
  profilesState = { loaded: false, autoCreated: false };
  if (gid === personalGroupId()) subscribeAggregate();
  else subscribeGroupData(gid);
  emit('data'); emit('status');
}

/* Souhrn: recept ve víc skupinách se ukáže jednou (podle id); `_gid` = kopie, se kterou
   se pracuje (přednost má osobní), `_gids` = všechny skupiny. Kategorie se stejným
   názvem se spojí, vzhled kategorií a profilovky taky. */
function subscribeAggregate() {
  const gids = state.groups.length ? state.groups.map(g => g.id) : [personalGroupId()];
  aggregateKey = gids.join(',');
  const recipes = {};
  const meta = Object.fromEntries(gids.map(g => [g, {}]));
  const merge = () => {
    if (!gids.every(g => recipes[g])) return;   // čekáme na recepty všech skupin
    const byId = new Map();
    gids.forEach(gid => recipes[gid].forEach(r => {
      const have = byId.get(r.id);
      if (have) have._gids.push(gid);
      else byId.set(r.id, { ...r, _gid: gid, _gids: [gid] });
    }));
    const cats = [], styles = {}, avatars = {}, profiles = [];
    gids.forEach(gid => {
      const m = meta[gid];
      (m.categories || DEFAULT_CATS).forEach(c => { if (!cats.includes(c)) cats.push(c); });
      Object.entries(m.catStyles || {}).forEach(([k, v]) => { if (!(k in styles)) styles[k] = v; });
      Object.assign(avatars, m.avatarPhotos || {});
      (m.profiles || []).forEach(n => { if (!profiles.includes(n)) profiles.push(n); });
    });
    if (myName() && !profiles.includes(myName())) profiles.push(myName());
    Object.assign(state, { recipes: [...byId.values()], categories: cats, catStyles: styles, avatarPhotos: avatars, profiles });
    setLoaded();
    emit('data');
  };
  const field = { categories: 'list', catStyles: 'map', avatarPhotos: 'map', profiles: 'list' };
  gids.forEach(gid => {
    Object.entries(field).forEach(([name, key]) => listen(doc(db, 'groups', gid, 'meta', name), d => {
      meta[gid][name] = d.exists() ? d.data()[key] : undefined;
      merge();
    }, err => console.error(name + ' sync:', err), groupUnsubs));
    listen(collection(db, 'groups', gid, 'recipes'), snap => {
      recipes[gid] = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      merge();
    }, err => {
      console.error('recipes sync:', gid, err);
      recipes[gid] = [];   // nedostupná skupina nesmí zablokovat zbytek
      merge();
    }, groupUnsubs);
  });
  // žebříček minihry patří osobní kuchařce
  listen(doc(db, 'groups', personalGroupId(), 'meta', 'highScores'), d => {
    state.highScores = (d.exists() && d.data().map) ? d.data().map : {};
  }, err => console.error('highScores sync:', err), groupUnsubs);
}

let profilesState = { loaded: false, autoCreated: false };
function subscribeGroupData(gid) {
  const at = (...p) => doc(db, 'groups', gid, ...p);
  const on = (target, onNext, label) => listen(target, onNext, err => console.error(label + ' sync:', err), groupUnsubs);
  const metaField = (name, key, fallback, after) => on(at('meta', name), d => {
    state[name] = (d.exists() && d.data()[key]) ? d.data()[key] : fallback();
    after?.();
    emit('data');
  }, name);
  metaField('categories', 'list', () => [...DEFAULT_CATS]);
  metaField('profiles', 'list', () => [], () => { profilesState.loaded = true; autoCreateProfiles(); });
  metaField('catStyles', 'map', () => ({}));
  metaField('avatarPhotos', 'map', () => ({}), () => syncMyAvatarInto(gid));
  metaField('highScores', 'map', () => ({}));
  listen(collection(db, 'groups', gid, 'recipes'), snap => {
    state.recipes = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    setLoaded();
    autoCreateProfiles();
    emit('data');
  }, err => {
    console.error('recipes sync:', err);
    if (err.code === 'permission-denied' && gid !== personalGroupId()) { switchGroup(personalGroupId()); return; }
    setLoadError('Nepodařilo se načíst data z cloudu. Zkontroluj připojení k internetu.');
  }, groupUnsubs);
}

/* Jméno přihlášeného a autoři receptů bez profilu -> doplnit (jednou po načtení).
   Čeká na profily I recepty, jinak by se zapsal seznam sestavený z prázdna. */
function autoCreateProfiles() {
  if (profilesState.autoCreated || !profilesState.loaded || !state.loaded) return;
  profilesState.autoCreated = true;
  const missing = new Set();
  const me = myName();
  if (me && !state.profiles.includes(me)) missing.add(me);
  state.recipes.forEach(r => { const a = (r.author || '').trim(); if (a && !state.profiles.includes(a)) missing.add(a); });
  if (missing.size) {
    state.profiles = [...state.profiles, ...missing];
    saveMeta('profiles', { list: state.profiles }).catch(e => console.error('profiles:', e));
  }
}

// Profilová fotka je jedna pro účet, mapy jméno -> url jsou v každé skupině — doplnit, chybí-li.
function syncMyAvatarInto(gid) {
  let url = '';
  try { url = localStorage.getItem('kucharka-avatar-url') || ''; } catch { /* soukromý režim */ }
  const me = myName();
  if (!url || !me || state.avatarPhotos[me] === url || gid !== state.activeGroup) return;
  setDoc(doc(db, 'groups', gid, 'meta', 'avatarPhotos'), { map: { [me]: url } }, { merge: true })
    .catch(e => console.error('avatar sync:', e));
}

const gdoc = (...path) => doc(db, 'groups', state.activeGroup, ...path);
function saveMeta(id, payload) {
  if (!live()) return Promise.resolve();
  return setDoc(gdoc('meta', id), payload);
}

/* ================= Recepty ================= */
export const getRecipe = id => state.recipes.find(r => r.id === id) || null;
// Kopie receptu, se kterou se pracuje (hodnocení, sdílení).
const recipeRef = r => doc(db, 'groups', r._gid || state.activeGroup, 'recipes', r.id);

/* Nahraje fotku (data URL) a vrátí adresu. Dlouhá platnost je bezpečná: každé nahrání
   dostane nový token, takže se adresa změní a fotka se všem obnoví. */
async function uploadPhoto(path, dataUrl) {
  const photoRef = ref(storage, path);
  await uploadString(photoRef, dataUrl, 'data_url', { cacheControl: 'public, max-age=31536000' });
  return getDownloadURL(photoRef);
}

// Fotku mazat jen ze složky TÉHLE skupiny — kopie můžou ukazovat na cizí soubor.
async function deleteOwnPhoto(url, gid) {
  if (!url || !url.includes(`/o/groups%2F${gid}%2F`)) return;
  try { await deleteObject(ref(storage, url)); } catch { /* soubor nemusí existovat */ }
}

async function ensureCategoriesIn(gid, cats) {
  if (!cats.length) return;
  const cref = doc(db, 'groups', gid, 'meta', 'categories');
  const cd = await getDoc(cref);
  const list = (cd.exists() && cd.data().list) ? cd.data().list : [...DEFAULT_CATS];
  const missing = cats.filter(c => !list.includes(c));
  if (missing.length || !cd.exists()) await setDoc(cref, { list: [...list, ...missing] });
}

/* Nový nebo upravený recept. `fields`: { name, categories, cookTime, portions,
   ingredients[{qty,unit,name}], steps[], photo (url nebo data URL nové fotky) }.
   `targets` = do kterých kuchařek (bez něj tam, kde už je / aktivní). `assignTo`
   = { uid, name } nový autor (jen správce). Vrací id receptu.
   Obsah se propisuje do všech kuchařek; hodnocení patří každé zvlášť. */
export async function saveRecipe(id, fields, { targets, assignTo } = {}) {
  const existing = id ? getRecipe(id) : null;
  const isNew = !existing;
  const rid = existing ? existing.id : uid();
  const data = {
    ...fields,
    author: assignTo?.name || (isNew ? myName() : (existing.author || myName())),
    shared: existing?.shared || false,
    createdAt: existing?.createdAt || Date.now(),
    ...(isNew ? {} : { updatedAt: Date.now() }),
  };
  // uid autora: nový recept = já; starší bez uid doplní úprava autora; správce ho nechá chybět
  // (prázdné uid by autorovi úpravy zablokovalo)
  if (assignTo) data.authorUid = assignTo.uid;
  else if (isNew || existing.authorUid || isMine(existing)) data.authorUid = isNew ? currentUid() : (existing.authorUid || currentUid());

  if (demo()) {
    const r = { ...(existing || { reviews: [] }), ...data, id: rid };
    state.recipes = isNew ? [...state.recipes, r] : state.recipes.map(x => x.id === rid ? r : x);
    emit('data');
    return rid;
  }
  const present = existing ? recipeGroupsOf(existing) : [];
  const to = targets?.length ? targets : (present.length ? present : [state.activeGroup]);
  if (data.photo && data.photo.startsWith('data:')) data.photo = await uploadPhoto(`groups/${to[0]}/photos/${rid}.jpg`, data.photo);
  data.groups = to;
  const b = writeBatch(db);
  to.forEach(gid => {
    const r = doc(db, 'groups', gid, 'recipes', rid);
    if (present.includes(gid)) b.set(r, data, { merge: true });   // hodnocení zůstávají
    else b.set(r, { ...data, reviews: [] });
  });
  present.filter(gid => !to.includes(gid)).forEach(gid => b.delete(doc(db, 'groups', gid, 'recipes', rid)));
  await b.commit();
  await Promise.all(to.map(gid => ensureCategoriesIn(gid, recipeCategories(data))));
  return rid;
}

export async function deleteRecipe(id) {
  const r = getRecipe(id);
  if (demo()) { state.recipes = state.recipes.filter(x => x.id !== id); emit('data'); return; }
  const gids = r ? recipeGroupsOf(r) : [state.activeGroup];
  // nejdřív recept ze všech skupin, pak fotka (jinak recept s rozbitou fotkou)
  const b = writeBatch(db);
  gids.forEach(gid => b.delete(doc(db, 'groups', gid, 'recipes', id)));
  await b.commit();
  await Promise.all(gids.map(gid => deleteOwnPhoto(r?.photo || '', gid)));
  setCheckedSteps(id, new Set());
}

// Změna jen v kopii, se kterou se pracuje (hodnocení, sdílení) — smí ji i ne-autor.
async function updateRecipeCopy(r, fields) {
  if (demo()) { Object.assign(getRecipe(r.id) || {}, fields); emit('data'); return; }
  await updateDoc(recipeRef(r), fields);
}

export async function addReview(recipeId, { stars, comment = '' }) {
  const r = getRecipe(recipeId);
  if (!r) return;
  await updateRecipeCopy(r, { reviews: [...(r.reviews || []), {
    id: uid(), author: myName(), authorUid: currentUid(), stars, comment: comment.trim(), createdAt: Date.now(),
  }] });
}
export const canDeleteReview = rv => state.mode !== 'public' && isMine(rv);
export async function deleteReview(recipeId, reviewId) {
  const r = getRecipe(recipeId);
  if (r) await updateRecipeCopy(r, { reviews: (r.reviews || []).filter(rv => rv.id !== reviewId) });
}

// Veřejný odkaz (kdokoli s odkazem uvidí recept i bez přihlášení).
export const setRecipeShared = (recipeId, shared) => { const r = getRecipe(recipeId); return r && updateRecipeCopy(r, { shared }); };
export function shareUrl(r) {
  const gid = r._gid || state.activeGroup;
  const g = gid ? '?g=' + encodeURIComponent(gid) : '';
  // z bety vede odkaz do ostré appky — tu mají ostatní
  const base = location.pathname.replace(/\/kucharka-beta\//, '/kucharka/');
  return location.origin + base + g + '#/recept/' + encodeURIComponent(r.id);
}
// Do kterých kuchařek jde recept zkopírovat.
export const copyTargets = () => live() ? state.groups.filter(g => g.id !== state.activeGroup) : [];

/* Kopie do jiné skupiny jako NOVÝ recept, jehož jsem autorem. Hodnocení se nepřenášejí,
   fotka dostane vlastní soubor (kdyby ji původní recept smazal). */
export async function copyRecipeToGroup(recipeId, gid) {
  const r = getRecipe(recipeId);
  if (!r) return;
  const id = uid();
  const { id: _id, _match, _gid, _gids, groups, updatedAt, ...rest } = r;
  const data = { ...rest, groups: [gid], reviews: [], shared: false, authorUid: currentUid(), createdAt: Date.now() };
  if (r.photo && r.photo.startsWith('http')) {
    try {
      const blob = await (await fetch(r.photo)).blob();
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result); fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
      data.photo = await uploadPhoto(`groups/${gid}/photos/${id}.jpg`, dataUrl);
    } catch (e) { console.error('copy photo:', e); /* zůstane odkaz na původní fotku */ }
  }
  await setDoc(doc(db, 'groups', gid, 'recipes', id), data);
  await ensureCategoriesIn(gid, recipeCategories(r));
}

/* Veřejný náhled sdíleného receptu bez přihlášení: jediná výjimka ze zámku — přímý
   dotaz na jeden recept s `shared === true`. Vrací true, když se podařilo. */
export async function openPublicRecipe(id, gid = null) {
  try {
    const snap = await getDoc(gid ? doc(db, 'groups', gid, 'recipes', id) : doc(db, 'recipes', id));
    if (!snap.exists() || !snap.data().shared) return false;
    stop();
    state.mode = 'public';
    state.recipes = [{ ...snap.data(), id: snap.id }];
    setLoaded();
    emit('data');
    return true;
  } catch { return false; }
}

// Odškrtnuté kroky — jen v tomhle zařízení.
const stepsKey = id => 'kucharka-steps-' + id;
export function getCheckedSteps(id) {
  try { return new Set(JSON.parse(localStorage.getItem(stepsKey(id)) || '[]')); } catch { return new Set(); }
}
export function setCheckedSteps(id, set) {
  try { set.size ? localStorage.setItem(stepsKey(id), JSON.stringify([...set])) : localStorage.removeItem(stepsKey(id)); }
  catch { /* plná kvóta */ }
}

/* ================= Výpis, filtry, hledání ================= */
export const primaryCategory = r => recipeCategories(r)[0] || '';
export function catCount(key) {
  if (key === 'all') return state.recipes.length;
  if (key === 'none') return state.recipes.filter(r => recipeCategories(r).length === 0).length;
  return state.recipes.filter(r => recipeCategories(r).includes(key)).length;
}

/* filters: { authors: [jména], time: 'all'|'30'|'60'|'120'|'120+' }, sort: 'newest'|'alpha'|'best' */
function passes(r, { authors = [], time = 'all' } = {}) {
  if (authors.length && !authors.includes(r.author)) return false;
  if (time !== 'all') {
    const t = parseInt(r.cookTime) || 0;
    return time === '120+' ? t > 120 : t > 0 && t <= +time;
  }
  return true;
}
export function sortRecipes(list, sort = 'newest') {
  const l = [...list];
  if (sort === 'alpha') l.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'cs'));
  else if (sort === 'best') l.sort((a, b) => avgRating(b.reviews) - avgRating(a.reviews));
  else l.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return l;
}
// catKey: 'all' | 'none' (bez kategorie) | název kategorie
export function listRecipes(catKey = 'all', { filters, sort } = {}) {
  let list = state.recipes;
  if (catKey === 'none') list = list.filter(r => recipeCategories(r).length === 0);
  else if (catKey !== 'all') list = list.filter(r => recipeCategories(r).includes(catKey));
  return sortRecipes(list.filter(r => passes(r, filters)), sort);
}
/* mode 'name' = podle názvu; 'ingredients' = suroviny oddělené čárkou, řazeno podle
   počtu shod (výsledek nese `_match: { matched, total }`). null = prázdný dotaz. */
export function searchRecipes(q, mode = 'name', { filters, sort } = {}) {
  const nq = norm(q || '');
  if (!nq) return null;
  if (mode === 'name') return sortRecipes(state.recipes.filter(r => norm(r.name).includes(nq) && passes(r, filters)), sort);
  const tokens = nq.split(',').map(t => t.trim()).filter(Boolean);
  if (!tokens.length) return [];
  return state.recipes
    .map(r => ({ r, m: ingredientMatch(r, tokens) }))
    .filter(x => x.m.matched > 0 && passes(x.r, filters))
    .sort((a, b) => b.m.matched - a.m.matched || avgRating(b.r.reviews) - avgRating(a.r.reviews))
    .map(x => ({ ...x.r, _match: x.m }));
}

/* ================= Kategorie ================= */
// V souhrnu z víc skupin se kategorie neupravují (spojený seznam není nikde uložený).
export const categoriesEditable = () => state.mode !== 'public' && (!isAggregate() || state.groups.length <= 1);

async function updateRecipesWhere(match, change) {
  if (demo()) { state.recipes.forEach(r => { if (match(r)) Object.assign(r, change(r)); }); return; }
  const batch = writeBatch(db);
  let dirty = 0;
  state.recipes.forEach(r => { if (match(r)) { batch.update(recipeRef(r), change(r)); dirty++; } });
  if (dirty) await batch.commit();
}

export async function addCategory(name, style = null) {
  state.categories = [...state.categories, name];
  if (style) state.catStyles = { ...state.catStyles, [name]: style };
  emit('data');
  await Promise.all([saveMeta('categories', { list: state.categories }), style && saveMeta('catStyles', { map: state.catStyles })]);
}
export async function reorderCategories(order) {
  state.categories = order;
  emit('data');
  await saveMeta('categories', { list: order });
}
export async function setCategoryStyle(name, style) {
  state.catStyles = { ...state.catStyles, [name]: style };
  emit('data');
  await saveMeta('catStyles', { map: state.catStyles });
}
// Přejmenování se propíše do pořadí, vzhledu i všech receptů.
export async function renameCategory(oldName, newName) {
  if (state.catStyles[oldName]) {
    state.catStyles = { ...state.catStyles, [newName]: state.catStyles[oldName] };
    delete state.catStyles[oldName];
  }
  state.categories = state.categories.map(c => c === oldName ? newName : c);
  await Promise.all([saveMeta('categories', { list: state.categories }), saveMeta('catStyles', { map: state.catStyles })]);
  await updateRecipesWhere(r => recipeCategories(r).includes(oldName),
    r => ({ categories: recipeCategories(r).map(c => c === oldName ? newName : c) }));
  emit('data');
}
// Smazání: recepty zůstanou, jen přijdou o tohle zařazení. Starý recept nese kategorii
// i v poli `category` — maže se i tam, jinak by se přes recipeCategories() vrátila.
export async function deleteCategory(cat) {
  const hadStyle = !!state.catStyles[cat];
  if (hadStyle) { state.catStyles = { ...state.catStyles }; delete state.catStyles[cat]; }
  state.categories = state.categories.filter(c => c !== cat);
  await Promise.all([saveMeta('categories', { list: state.categories }), hadStyle && saveMeta('catStyles', { map: state.catStyles })]);
  await updateRecipesWhere(r => recipeCategories(r).includes(cat),
    r => ({ categories: recipeCategories(r).filter(c => c !== cat), category: '' }));
  emit('data');
}

/* ================= Skupiny ================= */
// Kód bez snadno zaměnitelných znaků (0/O, 1/I/L): 31^6 ≈ 900 milionů kombinací.
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newJoinCode = () => [...crypto.getRandomValues(new Uint32Array(6))].map(n => CODE_ABC[n % CODE_ABC.length]).join('');
export const normCode = c => (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Kód musí být unikátní: obsazený kód pravidla odmítnou a dávka se zruší — zkusit jiný.
export async function createGroup(name) {
  const me = currentUid();
  const gref = doc(collection(db, 'groups'));
  for (let i = 0; ; i++) {
    const code = newJoinCode();
    const b = writeBatch(db);
    b.set(gref, { name: name.trim(), code, personal: false, ownerUid: me, members: [me], memberNames: { [me]: myName() }, createdAt: Date.now() });
    b.set(doc(db, 'joinCodes', code), { gid: gref.id });
    try { await b.commit(); return gref.id; }
    catch (e) { if (i >= 4) throw e; }
  }
}

// Vrací id skupiny, nebo null, když kód neexistuje.
export async function joinGroup(rawCode) {
  const code = normCode(rawCode);
  if (code.length !== 6) return null;
  const snap = await getDoc(doc(db, 'joinCodes', code));
  if (!snap.exists()) return null;
  const gid = snap.data().gid;
  if (!state.groups.some(g => g.id === gid)) {
    await updateDoc(doc(db, 'groups', gid), { members: arrayUnion(currentUid()), [`memberNames.${currentUid()}`]: myName(), joinProof: code });
  }
  return gid;
}

export const renameGroup = (gid, name) => updateDoc(doc(db, 'groups', gid), { name: name.trim() });

// Nový kód (starý přestane platit, členové zůstávají).
export async function regenerateCode(gid) {
  const g = groupById(gid);
  for (let i = 0; ; i++) {
    const code = newJoinCode();
    const b = writeBatch(db);
    b.update(doc(db, 'groups', gid), { code });
    b.set(doc(db, 'joinCodes', code), { gid });
    if (g?.code) b.delete(doc(db, 'joinCodes', g.code));
    try { await b.commit(); return code; }
    catch (e) { if (i >= 4) throw e; }
  }
}

export const removeMember = (gid, memberUid) =>
  updateDoc(doc(db, 'groups', gid), { members: arrayRemove(memberUid), [`memberNames.${memberUid}`]: deleteField() });

// Odchod; odchází-li správce, předá správu dalšímu členovi.
export async function leaveGroup(gid) {
  const g = groupById(gid);
  const me = currentUid();
  const upd = { members: arrayRemove(me), [`memberNames.${me}`]: deleteField() };
  if (isGroupOwner(g)) upd.ownerUid = g.members.find(u => u !== me);
  await updateDoc(doc(db, 'groups', gid), upd);
}

// Smazání skupiny i s obsahem (jen správce; osobní kuchařka smazat nejde).
export async function deleteGroup(gid) {
  const g = groupById(gid);
  const recipes = await getDocs(collection(db, 'groups', gid, 'recipes'));
  const refs = recipes.docs.map(d => d.ref);
  for (const m of ['categories', 'catStyles', 'profiles', 'avatarPhotos', 'highScores']) refs.push(doc(db, 'groups', gid, 'meta', m));
  for (let i = 0; i < refs.length; i += 450) {
    const b = writeBatch(db);
    refs.slice(i, i + 450).forEach(r => b.delete(r));
    await b.commit();
  }
  recipes.docs.forEach(d => deleteOwnPhoto(d.data().photo, gid));
  const b = writeBatch(db);
  if (g?.code) b.delete(doc(db, 'joinCodes', g.code));
  b.delete(doc(db, 'groups', gid));
  await b.commit();
  if (state.activeGroup === gid) switchGroup(personalGroupId());
}

/* ================= Profil ================= */
// Přejmenování: účet, jméno ve skupinách, profily, autor receptů i hodnocení.
export async function renameMe(newName) {
  const oldName = myName();
  newName = newName.trim();
  if (!newName || newName === oldName) return;
  const renameIn = r => {
    const upd = {};
    if (r.author === oldName) upd.author = newName;
    if ((r.reviews || []).some(rv => rv.author === oldName))
      upd.reviews = r.reviews.map(rv => rv.author === oldName ? { ...rv, author: newName } : rv);
    return upd;
  };
  state.profiles = state.profiles.map(p => p === oldName ? newName : p);
  const movedPhoto = !!state.avatarPhotos[oldName];
  if (movedPhoto) { state.avatarPhotos = { ...state.avatarPhotos, [newName]: state.avatarPhotos[oldName] }; delete state.avatarPhotos[oldName]; }
  if (demo()) { state.recipes.forEach(r => Object.assign(r, renameIn(r))); emit('data'); return; }
  await setDisplayName(newName);
  await Promise.all(state.groups.map(g =>
    updateDoc(doc(db, 'groups', g.id), new FieldPath('memberNames', currentUid()), newName).catch(e => console.error('member name:', e))));
  await Promise.all([saveMeta('profiles', { list: state.profiles }), movedPhoto && saveMeta('avatarPhotos', { map: state.avatarPhotos })]);
  await updateRecipesWhere(r => Object.keys(renameIn(r)).length > 0, renameIn);
  emit('data');
}

/* Profilová fotka: lokálně (hned, i offline) + po přihlášení do Storage a do mapy
   každé mé skupiny, ať ji vidí ostatní. */
export function photoFor(name) {
  let mine = '';
  if (name && name === myName()) { try { mine = localStorage.getItem('kucharka-avatar-photo') || ''; } catch { /* */ } }
  return mine || (name && state.avatarPhotos[name]) || '';
}
export async function setMyAvatarPhoto(dataUrl) {
  try { localStorage.setItem('kucharka-avatar-photo', dataUrl); } catch { /* plná kvóta */ }
  const me = myName();
  if (live() && me) {
    const url = await uploadPhoto('avatars/' + currentUid() + '.jpg', dataUrl);
    try { localStorage.setItem('kucharka-avatar-url', url); } catch { /* plná kvóta */ }
    state.avatarPhotos = { ...state.avatarPhotos, [me]: url };
    await Promise.all(state.groups.map(g =>
      setDoc(doc(db, 'groups', g.id, 'meta', 'avatarPhotos'), { map: { [me]: url } }, { merge: true }).catch(e => console.error('avatar:', e))));
  }
  emit('data');
}
export async function removeMyAvatarPhoto() {
  try { localStorage.removeItem('kucharka-avatar-photo'); localStorage.removeItem('kucharka-avatar-url'); } catch { /* */ }
  const me = myName();
  if (state.avatarPhotos[me]) { state.avatarPhotos = { ...state.avatarPhotos }; delete state.avatarPhotos[me]; }
  if (live() && me) {
    await Promise.all(state.groups.map(g =>
      updateDoc(doc(db, 'groups', g.id, 'meta', 'avatarPhotos'), new FieldPath('map', me), deleteField()).catch(() => { /* fotku tam nemám */ })));
    try { await deleteObject(ref(storage, 'avatars/' + currentUid() + '.jpg')); } catch { /* soubor nemusí existovat */ }
  }
  emit('data');
}

// Minihra: uloží skóre, jen když je to osobní rekord. Vrací true při rekordu.
export function saveHighScore(score) {
  const name = myName();
  if (!name || !(score > 0) || score <= (state.highScores[name] || 0)) return false;
  state.highScores = { ...state.highScores, [name]: score };
  if (live()) setDoc(doc(db, 'groups', personalGroupId(), 'meta', 'highScores'), { map: state.highScores }).catch(e => console.error('score:', e));
  return true;
}

/* ================= Nákupní seznam =================
   Osobní seznam: shoppingLists/{uid} (v demu localStorage). Společné: sharedLists/{id} —
   založí ho ten, kdo nasdílí svůj seznam lidem ze skupin; jen on přidává lidi a ruší ho,
   ostatní můžou odejít. `state.shopping` = položky zobrazeného seznamu; všechny změny
   jdou přes setShoppingItems(), které je uloží tam, kam patří. */
const SHOPPING_LOCAL_KEY = 'kucharka-shopping-local';
const shopListKey = () => 'kucharka-shoplist-' + currentUid();

function loadShoppingLocal() {
  try { state.myShopping = JSON.parse(localStorage.getItem(SHOPPING_LOCAL_KEY) || '[]'); } catch { state.myShopping = []; }
  state.shopList = 'mine';
  state.shopping = state.myShopping;
}
export const shoppingIsLocal = () => !live();

const sharedBase = {};   // id společného seznamu -> položky podle posledního snímku z cloudu
function subscribeShopping() {
  const me = currentUid();
  listen(doc(db, 'shoppingLists', me), d => {
    // vlastní zápis se vrací hned zpátky — ten neohlašovat (rozhraní už je aktuální)
    if (d.metadata.hasPendingWrites) return;
    const items = (d.exists() && Array.isArray(d.data().items)) ? d.data().items : [];
    if (JSON.stringify(items) === JSON.stringify(state.myShopping)) return;
    state.myShopping = items;
    if (state.shopList === 'mine') { state.shopping = items; emit('shopping'); }
  }, err => console.error('shopping sync:', err));

  try { state.shopList = localStorage.getItem(shopListKey()) || 'mine'; } catch { state.shopList = 'mine'; }
  listen(query(collection(db, 'sharedLists'), where('members', 'array-contains', me)), snap => {
    state.sharedLists = snap.docs.map(d => ({ ...d.data(), id: d.id })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    snap.docs.forEach(d => { sharedBase[d.id] = d.data().items || []; });
    const cur = state.sharedLists.find(l => l.id === state.shopList);
    if (state.shopList !== 'mine' && !cur) {
      if (!snap.metadata.fromCache) emit('notice', { type: 'shared-list-gone' });
      selectShopList('mine');
      return;
    }
    if (cur && !snap.metadata.hasPendingWrites && JSON.stringify(cur.items || []) !== JSON.stringify(state.shopping)) state.shopping = cur.items || [];
    emit('shopping');
  }, err => console.error('shared lists sync:', err));
}

export function selectShopList(id) {
  state.shopList = id;
  try { localStorage.setItem(shopListKey(), id); } catch { /* soukromý režim */ }
  if (id !== 'mine') markShopListSeen(id);
  state.shopping = id === 'mine' ? state.myShopping : (state.sharedLists.find(l => l.id === id)?.items || []);
  emit('shopping');
}

// Uloží nový obsah zobrazeného seznamu (odškrtnutí, smazání, přeřazení…).
export async function setShoppingItems(items) {
  state.shopping = items;
  emit('shopping');
  if (state.shopList !== 'mine') return saveSharedList(state.shopList, items);
  state.myShopping = items;
  if (shoppingIsLocal()) {
    try { localStorage.setItem(SHOPPING_LOCAL_KEY, JSON.stringify(items)); } catch { /* plná kvóta */ }
    return;
  }
  await setDoc(doc(db, 'shoppingLists', currentUid()), { items });
}

export const newShoppingItem = text => ({ id: uid(), text: text.trim(), cat: classifyIngredient(text), done: false });
export function addShoppingItem(text) {
  if (!(text || '').trim()) return Promise.resolve();
  return setShoppingItems([...state.shopping, newShoppingItem(text)]);
}
// Ingredience receptu (přepočtené na porce: mult = zvolené porce / porce receptu). Vrací počet.
export async function addRecipeToShopping(recipeId, mult = 1) {
  const r = getRecipe(recipeId);
  const items = (r?.ingredients || []).filter(i => i.name).map(i => {
    const q = qtyLabel(i, mult, { hideCount: true });
    return { id: uid(), text: q ? `${i.name} (${q})` : i.name, cat: classifyIngredient(i.name), done: false };
  });
  if (items.length) await setShoppingItems([...state.shopping, ...items]);
  return items.length;
}

/* Společný seznam může upravovat víc lidí naráz — nepřepisuje se celé pole: z rozdílu
   proti poslední verzi z cloudu se vyčte, co jsem změnil JÁ, a v transakci se to
   přiloží na aktuální stav. */
async function saveSharedList(lid, local) {
  const base = sharedBase[lid] || [];
  const baseById = new Map(base.map(i => [i.id, JSON.stringify(i)]));
  const localIds = new Set(local.map(i => i.id));
  const removed = new Set(base.filter(i => !localIds.has(i.id)).map(i => i.id));
  const upserts = local.filter(i => baseById.get(i.id) !== JSON.stringify(i));
  const order = local.map(i => i.id);
  sharedBase[lid] = local.map(i => ({ ...i }));
  await runTransaction(db, async tx => {
    const r = doc(db, 'sharedLists', lid);
    const snap = await tx.get(r);
    if (!snap.exists()) return;
    const server = (snap.data().items || []).filter(i => !removed.has(i.id));
    const byId = new Map(server.map(i => [i.id, i]));
    upserts.forEach(i => byId.set(i.id, i));
    // známé položky v mém pořadí, cizí nové mezitím na konec
    const out = order.filter(id => byId.has(id)).map(id => byId.get(id));
    server.forEach(i => { if (!localIds.has(i.id)) out.push(byId.get(i.id)); });
    tx.update(r, { items: out, updatedAt: Date.now() });
  });
}

// Z mého osobního seznamu udělá společný: položky se do něj PŘESUNOU.
export async function createSharedList(people) {
  const me = currentUid();
  const names = { [me]: myName() };
  people.forEach(p => { names[p.uid] = p.name; });
  const r = doc(collection(db, 'sharedLists'));
  const list = { ownerUid: me, members: [me, ...people.map(p => p.uid)], memberNames: names, items: state.myShopping, createdAt: Date.now() };
  await setDoc(r, list);
  sharedBase[r.id] = state.myShopping.map(i => ({ ...i }));
  state.sharedLists = [...state.sharedLists, { ...list, id: r.id }];
  state.myShopping = [];
  await setDoc(doc(db, 'shoppingLists', me), { items: [] }).catch(e => console.error(e));
  selectShopList(r.id);
  return r.id;
}
export function addSharedListPeople(lid, people) {
  const upd = { members: arrayUnion(...people.map(p => p.uid)) };
  people.forEach(p => { upd[`memberNames.${p.uid}`] = p.name; });
  return updateDoc(doc(db, 'sharedLists', lid), upd);
}
export const removeSharedListPerson = (lid, memberUid) =>
  updateDoc(doc(db, 'sharedLists', lid), { members: arrayRemove(memberUid), [`memberNames.${memberUid}`]: deleteField() });
export const leaveSharedList = lid => removeSharedListPerson(lid, currentUid());
export const deleteSharedList = lid => deleteDoc(doc(db, 'sharedLists', lid));
export const isSharedListOwner = l => !!l && l.ownerUid === currentUid();

// Nově nasdílený seznam, který jsem ještě neotevřel (rozhraní ho může zvýraznit).
function seenShopLists() { try { return JSON.parse(localStorage.getItem('kucharka-shoplists-seen') || '[]'); } catch { return []; } }
function markShopListSeen(id) {
  const seen = seenShopLists();
  if (seen.includes(id)) return;
  try { localStorage.setItem('kucharka-shoplists-seen', JSON.stringify([...seen, id].slice(-50))); } catch { /* plná kvóta */ }
}
export const isShopListNew = l => !isSharedListOwner(l) && !seenShopLists().includes(l.id);
