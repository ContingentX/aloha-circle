// AlohaLive mobile MVP: visitor signup → match card, against the agentharness API.
// Point API base at your machine's LAN IP (the phone can't reach localhost).
import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaView, ScrollView, View, Text, TextInput,
  TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';

const INTERESTS = ['ocean', 'diving', 'hiking', 'wildlife', 'photography', 'farming', 'cooking', 'community'];

export default function App() {
  const [apiBase, setApiBase] = useState('http://localhost:8787');
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

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>
          Aloha<Text style={styles.accent}>Live</Text>
        </Text>
        <Text style={styles.tagline}>Don't just visit Maui. Meet Maui.</Text>

        {match ? (
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
        ) : (
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
        )}

        <View style={styles.card}>
          <Text style={styles.hint}>Agent API (use your computer's LAN IP from a phone):</Text>
          <TextInput style={styles.input} value={apiBase} onChangeText={setApiBase} autoCapitalize="none" />
        </View>
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
});
