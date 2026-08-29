import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from './firebase.js';
import { appApi } from './appApi.js';

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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(false);

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) { setProfile(null); return null; }
    const { profile } = await appApi.me();
    setProfile(profile);
    return profile;
  }, []);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setReady(true);
        if (u) refreshProfile().catch(() => {});
        else setProfile(null);
      }),
    [refreshProfile],
  );

  const signInWithGoogle = async () => {
    const cred = await signInWithPopup(auth, googleProvider);
    await appApi.saveProfile({ name: cred.user.displayName ?? '', photoURL: cred.user.photoURL ?? '' });
    await refreshProfile();
    return cred.user;
  };

  const saveProfile = async (fields) => {
    const { profile } = await appApi.saveProfile(fields);
    setProfile(profile);
  };

  // Nonprofit: claim a domain. Instant when the Google account is on it,
  // otherwise the API emails a 6-digit code to an @domain inbox (SES).
  const claimNpoDomain = async (rawDomain, orgName) => {
    const { result } = await appApi.npoClaim(orgName, normalizeDomain(rawDomain));
    await refreshProfile();
    return result; // 'verified' | 'needs-email-proof'
  };

  const sendDomainCode = async (email) => {
    await appApi.npoSendCode(email);
    await refreshProfile();
  };

  const verifyDomainCode = async (code) => {
    await appApi.npoVerifyCode(code);
    await refreshProfile();
  };

  // Local: airport + a photo of a bill showing a local address, uploaded
  // straight to S3 via a presigned URL; review flips pending -> verified.
  const submitLocalVerification = async (airport, file) => {
    const { uploadUrl } = await appApi.localSubmit(airport, file.type);
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
    if (!put.ok) throw new Error('upload failed — please try again');
    await refreshProfile();
  };

  const value = {
    user, profile, ready,
    signInWithGoogle,
    signOutUser: () => signOut(auth),
    saveProfile,
    refreshProfile,
    claimNpoDomain,
    sendDomainCode,
    verifyDomainCode,
    submitLocalVerification,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
