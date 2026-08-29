import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Auth lives in the ContingentX org Firebase project; AlohaLive data is isolated
// in the named Firestore database "alohalive" and the dedicated bucket below.
// The apiKey is a public client identifier, not a secret — access control is
// enforced by Firebase security rules (infra/firestore.alohalive.rules,
// infra/storage.alohalive.rules).
const firebaseConfig = {
  apiKey: 'AIzaSyAVwTLIwUHUq4-IDdFr9DSHA9tf6rPr_II',
  authDomain: 'contingentx-b0eab.firebaseapp.com',
  projectId: 'contingentx-b0eab',
  storageBucket: 'contingentx-alohalive',
  messagingSenderId: '773876661627',
  appId: '1:773876661627:web:83f06abdb3735d605291de',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app, 'alohalive');
export const storage = getStorage(app, 'gs://contingentx-alohalive');

// Only OGG for launch; more islands later.
export const AIRPORTS = [{ code: 'OGG', name: 'Kahului Airport · Maui' }];
