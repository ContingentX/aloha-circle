// AlohaLive mobile MVP: Google sign-in + donate-and-spin wheel against the
// hosted AWS API, plus the visitor→match flow against the agentharness API.
// Sign-in and Stripe Checkout run in the system browser via the web bridge
// pages (/applogin, /appreturn) and hand back to us through our deep link.
import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import {
  SafeAreaView, ScrollView, View, Text, TextInput,
  TouchableOpacity, StyleSheet, ActivityIndicator, Animated, Easing,
} from 'react-native';

const API_BASE = 'https://vsrvqrddll.execute-api.us-east-1.amazonaws.com';
// The web app that hosts the sign-in and Stripe-return bridge pages.
// Point at https://alohalive.net for a production build.
const BRIDGE_BASE = 'https://dev.alohalive.net';

const INTERESTS = ['ocean', 'diving', 'hiking', 'wildlife', 'photography', 'farming', 'cooking', 'community'];

// Fragment params from a deep-link URL: exp://…/--/auth#idToken=…&name=…
const fragmentParams = (url) => {
  const hash = url.split('#')[1] ?? '';
  return Object.fromEntries(new URLSearchParams(hash));
};

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function SignInCard({ onToken, onError }) {
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    onError(null);
    try {
      const redirect = Linking.createURL('auth');
      const login = `${BRIDGE_BASE}/applogin?return=${encodeURIComponent(redirect)}`;
      const result = await WebBrowser.openAuthSessionAsync(login, redirect);
      if (result.type === 'success') {
        const { idToken, name } = fragmentParams(result.url);
        if (!idToken) throw new Error('sign-in did not return a token');
        onToken(idToken, name ?? '');
      }
    } catch (err) {
      onError(String(err.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.h3}>🤙 E komo mai</Text>
      <Text style={styles.line}>Sign in to donate, spin for experiences, and join the ohana.</Text>
      <TouchableOpacity style={styles.cta} disabled={busy} onPress={signIn}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Sign in with Google</Text>}
      </TouchableOpacity>
    </View>
  );
}

function WheelCard({ token, onAuthExpired }) {
  const [experiences, setExperiences] = useState(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const angle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    api('/experiences')
      .then(({ experiences }) => setExperiences(experiences))
      .catch((err) => setError(String(err.message ?? err)));
  }, []);

  const top = experiences?.[0];

  const finishSpin = async (sessionId) => {
    setSpinning(true);
    setError(null);
    angle.setValue(0);
    const wheel = new Promise((resolve) =>
      Animated.timing(angle, {
        toValue: 1,
        duration: 2600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(resolve),
    );
    try {
      const [outcome] = await Promise.all([api(`/spin?session_id=${encodeURIComponent(sessionId)}`), wheel]);
      setResult(outcome);
    } catch (err) {
      setError(String(err.message ?? err));
    } finally {
      setSpinning(false);
    }
  };

  const donate = async () => {
    setBusy(true);
    setError(null);
    try {
      const redirect = Linking.createURL('spin');
      const { url } = await api('/donate', {
        method: 'POST',
        body: { experienceId: top.id, amountUsd: Number(amount || top.minDonation), appReturn: redirect },
      });
      const res = await WebBrowser.openAuthSessionAsync(url, redirect);
      if (res.type === 'success') {
        const { spin } = fragmentParams(res.url);
        if (spin) await finishSpin(spin);
      }
    } catch (err) {
      if (err.status === 401) onAuthExpired();
      setError(String(err.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  if (error && !top) {
    return (
      <View style={styles.card}>
        <Text style={styles.h3}>🎡 Donate &amp; spin</Text>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!experiences) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color="#0b5d8a" />
      </View>
    );
  }
  if (!top) return null;

  if (spinning || result) {
    const rotate = angle.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '1800deg'] });
    return (
      <View style={[styles.card, styles.matchCard]}>
        <Text style={styles.h3}>
          {spinning ? '🎡 Spinning…' : result?.won ? '🌺 You won!' : '🌊 Mahalo!'}
        </Text>
        <Animated.View style={[styles.wheel, { transform: [{ rotate }] }]}>
          <Text style={styles.wheelFace}>🌺</Text>
        </Animated.View>
        {!spinning && result && (
          <>
            <Text style={styles.line}>
              {result.won
                ? `You won: ${result.title}! The nonprofit will reach out with details.`
                : `No prize this time, but your $${result.amountUsd} keeps Maui's causes alive. Mahalo nui loa.`}
            </Text>
            <TouchableOpacity style={styles.cta} onPress={() => setResult(null)}>
              <Text style={styles.ctaText}>Back to the wheel</Text>
            </TouchableOpacity>
          </>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.h3}>🎡 Donate &amp; spin for: {top.title}</Text>
      <Text style={styles.line}>{top.description}</Text>
      <Text style={styles.hint}>
        ${top.value} value · minimum donation ${top.minDonation} · win odds set by daily/monthly caps
      </Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        placeholder={`$${top.minDonation}`}
        value={amount}
        onChangeText={setAmount}
      />
      <TouchableOpacity style={styles.cta} disabled={busy} onPress={donate}>
        {busy ? <ActivityIndicator color="#fff" /> : (
          <Text style={styles.ctaText}>Donate ${amount || top.minDonation} &amp; spin</Text>
        )}
      </TouchableOpacity>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function MatchCard({ apiBase, setApiBase }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState([]);
  const [match, setMatch] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const toggle = (tag) =>
    setSelected((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/visitors`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, interests: selected }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMatch(body.match);
    } catch (err) {
      setError(String(err.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  if (match) {
    return (
      <View style={[styles.card, styles.matchCard]}>
        <Text style={styles.h3}>🌊 Your Maui Match</Text>
        <Text style={styles.line}><Text style={styles.bold}>Meet:</Text> {match.localName}, {match.localTown}</Text>
        <Text style={styles.line}><Text style={styles.bold}>Cause:</Text> {match.cause}</Text>
        <Text style={styles.line}><Text style={styles.bold}>Why:</Text> {match.why}</Text>
        <Text style={styles.line}><Text style={styles.bold}>Today:</Text> {match.suggestedAction}</Text>
        <TouchableOpacity style={styles.cta} onPress={() => setMatch(null)}>
          <Text style={styles.ctaText}>Start over</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.h3}>What brought you to Maui?</Text>
        <TextInput style={styles.input} placeholder="Your name" value={name} onChangeText={setName} />
        <View style={styles.chips}>
          {INTERESTS.map((tag) => (
            <TouchableOpacity
              key={tag}
              style={[styles.chip, selected.includes(tag) && styles.chipOn]}
              onPress={() => toggle(tag)}
            >
              <Text style={selected.includes(tag) ? styles.chipTextOn : styles.chipText}>{tag}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.cta, (!name || selected.length === 0) && styles.ctaOff]}
          disabled={busy || !name || selected.length === 0}
          onPress={submit}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Meet Maui</Text>}
        </TouchableOpacity>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
      <View style={styles.card}>
        <Text style={styles.hint}>Agent API (use your computer's LAN IP from a phone):</Text>
        <TextInput style={styles.input} value={apiBase} onChangeText={setApiBase} autoCapitalize="none" />
      </View>
    </>
  );
}

export default function App() {
  const [token, setToken] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [profile, setProfile] = useState(null);
  const [apiBase, setApiBase] = useState('http://localhost:8787');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) { setProfile(null); return; }
    api('/me', { token })
      .then(({ profile }) => setProfile(profile))
      .catch((err) => {
        if (err.status === 401) setToken(null);
        else setError(String(err.message ?? err));
      });
  }, [token]);

  const onToken = (idToken, name) => {
    setToken(idToken);
    setDisplayName(name);
  };

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>
          Aloha<Text style={styles.accent}>Live</Text>
        </Text>
        <Text style={styles.tagline}>Don't just visit Maui. Meet Maui.</Text>

        {token ? (
          <View style={styles.card}>
            <Text style={styles.h3}>🤙 Aloha, {profile?.name || displayName || 'friend'}</Text>
            <TouchableOpacity onPress={() => setToken(null)}>
              <Text style={styles.hint}>Sign out</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <SignInCard onToken={onToken} onError={setError} />
        )}
        {error && <Text style={styles.error}>{error}</Text>}

        <WheelCard token={token} onAuthExpired={() => setToken(null)} />
        <MatchCard apiBase={apiBase} setApiBase={setApiBase} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fdf6ec' },
  scroll: { padding: 20 },
  h1: { fontSize: 34, fontWeight: '700', color: '#073b57', marginTop: 12 },
  accent: { color: '#ff6b57' },
  tagline: { fontSize: 16, color: '#0b5d8a', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14 },
  matchCard: { borderWidth: 2, borderColor: '#1c7c54' },
  h3: { fontSize: 18, fontWeight: '600', color: '#073b57', marginBottom: 8 },
  line: { fontSize: 15, marginVertical: 2, color: '#16303f' },
  bold: { fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#c6d8e2', borderRadius: 10, padding: 10, marginVertical: 6, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 },
  chip: { borderWidth: 1, borderColor: '#c6d8e2', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 },
  chipOn: { backgroundColor: '#1c7c54', borderColor: '#1c7c54' },
  chipText: { color: '#16303f' },
  chipTextOn: { color: '#fff' },
  cta: { backgroundColor: '#ff6b57', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  ctaOff: { opacity: 0.5 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  hint: { color: '#5a7484', fontSize: 13 },
  error: { color: '#b3261e', marginTop: 8 },
  wheel: {
    alignSelf: 'center', width: 140, height: 140, borderRadius: 70, marginVertical: 16,
    borderWidth: 8, borderColor: '#1c7c54', backgroundColor: '#fdf6ec',
    alignItems: 'center', justifyContent: 'center',
  },
  wheelFace: { fontSize: 48 },
});
