import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
} from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { auth, googleProvider, db, storage } from './firebase.js';

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export const emailDomain = (email) => (email ?? '').split('@')[1]?.toLowerCase() ?? '';

export const normalizeDomain = (input) =>
  input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];

const PROOF_KEY = 'alohalive.domainProof'; // { email, domain, claimUid } across the email-link round trip

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setReady(true); }), []);

  useEffect(() => {
    if (!user) { setProfile(null); return; }
    return onSnapshot(doc(db, 'users', user.uid), (snap) => setProfile(snap.data() ?? null));
  }, [user?.uid]);

  // A nonprofit's verified flag is derived from its domainProofs doc; rules only
  // accept status "verified" when that proof names this uid.
  useEffect(() => {
    const p = profile;
    if (!user || !p || p.role !== 'nonprofit' || !p.domain) return;
    if (p.verification?.status === 'verified') return;
    getDoc(doc(db, 'domainProofs', p.domain)).then((proof) => {
      if (proof.exists() && proof.data().claimedBy === user.uid) {
        setDoc(
          doc(db, 'users', user.uid),
          { verification: { status: 'verified', method: 'email-link', proofEmail: proof.data().proofEmail } },
          { merge: true },
        );
      }
    }).catch(() => {});
  }, [user?.uid, profile?.domain, profile?.verification?.status, profile?.role]);

  const signInWithGoogle = async () => {
    const cred = await signInWithPopup(auth, googleProvider);
    await setDoc(
      doc(db, 'users', cred.user.uid),
      {
        name: cred.user.displayName ?? '',
        email: cred.user.email ?? '',
        photoURL: cred.user.photoURL ?? '',
        lastSeenAt: serverTimestamp(),
      },
      { merge: true },
    );
    return cred.user;
  };

  const saveProfile = (fields) =>
    setDoc(doc(db, 'users', user.uid), fields, { merge: true });

  // Nonprofit path 1: Google account already lives on the claimed domain.
  const claimNpoDomain = async (rawDomain, orgName) => {
    const domain = normalizeDomain(rawDomain);
    await saveProfile({ role: 'nonprofit', orgName, domain, verification: { status: 'unverified' } });
    if (emailDomain(user.email) === domain) {
      await setDoc(doc(db, 'domainProofs', domain), {
        claimedBy: user.uid,
        proofEmail: user.email,
        verifiedAt: serverTimestamp(),
      });
      await saveProfile({ verification: { status: 'verified', method: 'google-domain', proofEmail: user.email } });
      return 'verified';
    }
    return 'needs-email-proof';
  };

  // Nonprofit path 2: prove control of an inbox at the claimed domain via a
  // Firebase email sign-in link sent to it.
  const sendDomainProofLink = async (email, domain) => {
    if (emailDomain(email) !== domain) throw new Error(`Email must be @${domain}`);
    localStorage.setItem(PROOF_KEY, JSON.stringify({ email, domain, claimUid: user.uid }));
    await sendSignInLinkToEmail(auth, email, {
      url: `${window.location.origin}/?domainProof=1`,
      handleCodeInApp: true,
    });
    await saveProfile({ verification: { status: 'pending', method: 'email-link', proofEmail: email } });
  };

  // Local path: airport + a photo of a bill showing a local address; a human
  // (later: the agent) reviews it, so status lands at "pending".
  const submitLocalVerification = async (airport, file) => {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `verify/${user.uid}/bill.${ext}`;
    await uploadBytes(ref(storage, path), file, { contentType: file.type });
    await saveProfile({
      role: 'local',
      airport,
      verification: { status: 'pending', method: 'bill-photo', billPath: path, submittedAt: serverTimestamp() },
    });
  };

  const value = {
    user, profile, ready,
    signInWithGoogle,
    signOutUser: () => signOut(auth),
    saveProfile,
    claimNpoDomain,
    sendDomainProofLink,
    submitLocalVerification,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---- Email-link landing (runs before AuthProvider mounts state) ----

export const pendingDomainProof = () =>
  isSignInWithEmailLink(auth, window.location.href) ? JSON.parse(localStorage.getItem(PROOF_KEY) ?? 'null') : null;

// Signing in with the email link switches the session to the nonprofit-inbox
// account; that session writes the domain proof (rules require the writer's
// verified email to be on the claimed domain), then we sign out so the owner
// can sign back in with Google and pick up the verified flag.
export async function completeDomainProof(stored) {
  const email = stored?.email ?? window.prompt('Confirm the nonprofit email address the link was sent to:');
  if (!email) throw new Error('Email is required to finish verification.');
  const domain = stored?.domain ?? emailDomain(email);
  const claimUid = stored?.claimUid;
  if (!claimUid) throw new Error('This link must be opened in the same browser where you requested it.');
  await signInWithEmailLink(auth, email, window.location.href);
  await setDoc(doc(db, 'domainProofs', domain), {
    claimedBy: claimUid,
    proofEmail: email,
    verifiedAt: serverTimestamp(),
  });
  localStorage.removeItem(PROOF_KEY);
  await signOut(auth);
  window.history.replaceState(null, '', window.location.origin);
  return domain;
}
