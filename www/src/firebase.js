import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// Firebase is ONLY the Google sign-in door (the ContingentX org project already
// has a working Google OAuth client). All app data lives in AWS behind the
// Aloha Circle API — see infra/README-aws-auth.md. The apiKey is a public client
// identifier, not a secret.
const firebaseConfig = {
  apiKey: 'AIzaSyAVwTLIwUHUq4-IDdFr9DSHA9tf6rPr_II',
  authDomain: 'contingentx-b0eab.firebaseapp.com',
  projectId: 'contingentx-b0eab',
  appId: '1:773876661627:web:83f06abdb3735d605291de',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Only OGG for launch; more islands later.
export const AIRPORTS = [{ code: 'OGG', name: 'Kahului Airport · Maui' }];
