// Přihlášení (Firebase Auth) — jen logika, žádné UI. Obrazovky přihlášení si staví
// vrstva rozhraní a volá tyhle funkce; chyby převádí na text přes authErrorMessage().
import {
  auth,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut as fbSignOut, sendPasswordResetEmail, sendEmailVerification, updateProfile,
  reauthenticateWithCredential, EmailAuthProvider, updatePassword,
  setPersistence, browserLocalPersistence,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult
} from './firebase.js';

/* Přihlášení se ukládá natrvalo (po zavření appky zůstává člověk přihlášený).
   `persistenceReady` — počkat na něj před přihlášením, jinak by se nemuselo uložit. */
const persistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => {});

/* Google: nejdřív popup, přesměrování jen jako nouzovka. Appka běží na jiné doméně
   (github.io) než authDomain (…firebaseapp.com) a Safari rozdělané přesměrování mezi
   doménami zahazuje — tiše, bez chyby. Značka v sessionStorage pozná, že přesměrování
   běželo a nedokončilo se (viz checkRedirectResult). Apple přihlášení záměrně není
   (vyžaduje placený Apple Developer Program). */
const REDIRECT_FLAG = 'kucharka-auth-redirect';
const flagSet = v => { try { v ? sessionStorage.setItem(REDIRECT_FLAG, '1') : sessionStorage.removeItem(REDIRECT_FLAG); } catch { /* soukromý režim */ } };
const flagGet = () => { try { return !!sessionStorage.getItem(REDIRECT_FLAG); } catch { return false; } };

export async function signInWithGoogle() {
  await persistenceReady;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });   // na sdíleném zařízení vybrat účet
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment',
         'auth/cancelled-popup-request'].includes(e.code)) {
      flagSet(true);
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}

/* Volat jednou při startu. Vrací null (vše v pořádku / žádné přesměrování neběželo),
   nebo text chyby, kterou má rozhraní ukázat. */
export async function checkRedirectResult() {
  try {
    const res = await getRedirectResult(auth);
    if (!flagGet()) return null;
    flagSet(false);
    if (!res || !res.user) {
      return 'Prohlížeč kvůli ochraně soukromí zahodil rozdělané přihlášení přes Google. ' +
        'Zkus to prosím znovu, nebo se přihlas e-mailem a heslem, to funguje vždycky.';
    }
    return null;
  } catch (e) {
    flagSet(false);
    return authErrorMessage(e);
  }
}

// Zrušené okno Googlu není chyba, kterou by bylo potřeba hlásit.
export const isCancelledSignIn = e => e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request';

export async function signInWithEmail(email, password) {
  await persistenceReady;
  return signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
}

/* Registrace: účet + jméno + ověřovací e-mail. Vrací { sent } — i když se e-mail
   nepodaří odeslat, účet už existuje a uživatel patří na obrazovku ověření
   (odtud si ho pošle znovu), ne zpátky do formuláře. */
export async function signUpWithEmail(name, email, password) {
  await persistenceReady;
  const cred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  await updateProfile(cred.user, { displayName: name.trim() });
  try { await sendVerification(); markResent(); return { sent: true }; }
  catch (e) { console.error('verify mail:', e); return { sent: false }; }
}

export function sendPasswordReset(email) {
  return sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

// Odkaz v ověřovacím e-mailu vede zpátky do appky.
function sendVerification() {
  return sendEmailVerification(auth.currentUser, { url: location.origin + location.pathname });
}

/* Opětovné odeslání ověřovacího e-mailu. Firebase další e-mail hned po prvním
   odmítne, proto odpočet: resendWaitSeconds() vrací, kolik zbývá. */
export const RESEND_WAIT = 60;
let resendReadyAt = 0;
const markResent = () => { resendReadyAt = Date.now() + RESEND_WAIT * 1000; };
export const resendWaitSeconds = () => Math.max(0, Math.ceil((resendReadyAt - Date.now()) / 1000));
export async function resendVerification() {
  try { await sendVerification(); markResent(); }
  catch (e) { if (e.code === 'auth/too-many-requests') markResent(); throw e; }
}

// Uživatel tvrdí, že e-mail potvrdil: načíst stav znovu. Vrací true, když je ověřený.
export async function recheckEmailVerified() {
  try { await auth.currentUser?.reload(); } catch { /* offline */ }
  return !!auth.currentUser?.emailVerified;
}

/* Čerstvě ověřený e-mail: uložený přihlašovací klíč o ověření ještě neví (obnovuje
   se sám až po hodině) a pravidla Firestore by do té doby všechno odmítala. */
export async function refreshTokenIfStale(user) {
  try {
    if (user.emailVerified && !(await user.getIdTokenResult()).claims.email_verified) await user.getIdToken(true);
  } catch { /* offline — zkusí se s tím, co je */ }
}

/* Stav přihlášení. Callback dostane jeden ze stavů:
   'signed-out' | 'verify-email' (účet bez potvrzeného e-mailu) |
   'need-name' (účet bez jména — recepty by neměly autora) | 'ready' */
export function watchAuth(cb) {
  return onAuthStateChanged(auth, user => {
    if (!user) cb('signed-out', null);
    else if (!user.emailVerified) cb('verify-email', user);
    else if (!user.displayName) cb('need-name', user);
    else cb('ready', user);
  });
}

export const currentUid = () => auth.currentUser?.uid || '';
export const currentDisplayName = () => auth.currentUser?.displayName || '';
export const currentEmail = () => auth.currentUser?.email || '';
// Účet přes Google nemá heslo -> nedává smysl nabízet jeho změnu.
export const hasPasswordProvider = () => !!auth.currentUser?.providerData?.some(p => p.providerId === 'password');

export const setDisplayName = name => updateProfile(auth.currentUser, { displayName: name.trim() });
export const signOut = () => fbSignOut(auth);

export async function changePassword(currentPassword, newPassword) {
  const cred = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
  await reauthenticateWithCredential(auth.currentUser, cred);
  await updatePassword(auth.currentUser, newPassword);
}

export function authErrorMessage(e) {
  const map = {
    'auth/invalid-email': 'Neplatný formát e-mailu.',
    'auth/invalid-credential': 'Nesprávný e-mail nebo heslo.',
    'auth/wrong-password': 'Nesprávný e-mail nebo heslo.',
    'auth/user-not-found': 'Nesprávný e-mail nebo heslo.',
    'auth/email-already-in-use': 'S tímhle e-mailem už účet existuje. Zkus se rovnou přihlásit.',
    'auth/weak-password': 'Heslo musí mít alespoň 6 znaků.',
    'auth/too-many-requests': 'Příliš mnoho pokusů, zkus to za chvíli.',
    'auth/network-request-failed': 'Zkontroluj připojení k internetu.',
    'auth/popup-closed-by-user': 'Okno přihlášení bylo zavřeno.',
    'auth/user-cancelled': 'Přihlášení bylo zrušeno.',
    'auth/operation-not-allowed': 'Tenhle způsob přihlášení není zapnutý ve Firebase konzoli (Authentication → Sign-in method).',
    'auth/unauthorized-domain': 'Tahle adresa není povolená ve Firebase (Authentication → Settings → Authorized domains).',
    'auth/account-exists-with-different-credential':
      'S tímhle e-mailem už účet existuje, jen byl vytvořen jinak. Přihlas se původním způsobem (e-mailem a heslem).',
  };
  return map[e?.code] || 'Něco se nepovedlo. Zkus to znovu.';
}
