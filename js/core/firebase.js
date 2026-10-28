// Firebase — konfigurace a jediné místo, odkud zbytek appky bere funkce SDK.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch,
  arrayUnion, arrayRemove, deleteField, FieldPath, query, where, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadString, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, sendEmailVerification, updateProfile,
  reauthenticateWithCredential, EmailAuthProvider, updatePassword,
  setPersistence, browserLocalPersistence,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC27AgDJBgxCOAtaW78MrLI5Z6rCfC5Vi8",
  authDomain: "kucharka-c4a3f.firebaseapp.com",
  projectId: "kucharka-c4a3f",
  storageBucket: "kucharka-c4a3f.firebasestorage.app",
  messagingSenderId: "370875039038",
  appId: "1:370875039038:web:095e1dc28881dc903e806f"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
export {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch,
  arrayUnion, arrayRemove, deleteField, FieldPath, query, where, runTransaction,
  ref, uploadString, getDownloadURL, deleteObject,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, sendEmailVerification, updateProfile,
  reauthenticateWithCredential, EmailAuthProvider, updatePassword,
  setPersistence, browserLocalPersistence,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult
};
