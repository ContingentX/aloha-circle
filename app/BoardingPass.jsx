// Traveler verification: scan the boarding-pass barcode (BCBP) to pull the
// origin → OGG route and arrival date, seed the greeting language from the
// origin airport, and mark the profile as a verified traveler. The barcode is
// parsed on-device and discarded — only route, date, and language are saved.
import { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { parseBoardingPass } from './bcbp.js';
import { LANGUAGES, airportCity, airportLang } from './airports.js';
import { styles } from './styles.js';

const prettyDate = (iso) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;

function LanguagePicker({ value, onChange }) {
  return (
    <View style={styles.chips}>
      {Object.entries(LANGUAGES).map(([code, { label }]) => (
        <TouchableOpacity
          key={code}
          style={[styles.chip, value === code && styles.chipOn]}
          onPress={() => onChange(code)}
        >
          <Text style={value === code ? styles.chipTextOn : styles.chipText}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function BoardingPassCard({ profile, onSave }) {
  const [mode, setMode] = useState('idle'); // idle | scan | manual | confirm
  const [pending, setPending] = useState(null); // { from, dateISO, verified, lang }
  const [manualCode, setManualCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  if (profile?.travelerVerified || (profile?.originAirport && mode === 'idle' && !pending)) {
    const lang = LANGUAGES[profile.language] ?? LANGUAGES.en;
    return (
      <View style={[styles.card, styles.matchCard]}>
        {profile.travelerVerified && (
          <View style={styles.badge}><Text style={styles.badgeText}>✓ Verified traveler</Text></View>
        )}
        <Text style={styles.greeting}>{lang.greeting}</Text>
        <Text style={styles.line}>
          {airportCity(profile.originAirport)} → Maui{profile.arrivalDate ? ` · ${prettyDate(profile.arrivalDate)}` : ''}
        </Text>
        <Text style={styles.hint}>Your aloha explainer will play in {lang.label} — spin the wheel below to meet your first cause.</Text>
      </View>
    );
  }

  const startScan = async () => {
    setError(null);
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) { setError('Camera permission is needed to scan — or enter your airport below.'); return; }
    }
    handled.current = false;
    setMode('scan');
  };

  const onScanned = ({ data }) => {
    if (handled.current) return;
    const parsed = parseBoardingPass(data);
    if (!parsed) return; // not a boarding pass (e.g. a URL QR) — keep scanning
    handled.current = true;
    setPending({ from: parsed.from, dateISO: parsed.dateISO, verified: true, lang: airportLang(parsed.from) });
    setMode('confirm');
  };

  const useManual = () => {
    const code = manualCode.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) { setError('Airport codes are 3 letters, like KIX or SEA.'); return; }
    setPending({ from: code, dateISO: null, verified: false, lang: airportLang(code) });
    setError(null);
    setMode('confirm');
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        role: 'traveler',
        originAirport: pending.from,
        ...(pending.dateISO ? { arrivalDate: pending.dateISO } : {}),
        travelerVerified: pending.verified,
        language: pending.lang,
      });
      setMode('idle');
      setPending(null);
    } catch (err) {
      setError(String(err.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'scan') {
    return (
      <View style={styles.card}>
        <Text style={styles.h3}>✈️ Scan your boarding pass</Text>
        <Text style={styles.hint}>Point at the barcode — paper or phone wallet both work. We only read your route and date.</Text>
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ['pdf417', 'qr', 'aztec', 'datamatrix'] }}
          onBarcodeScanned={onScanned}
        />
        <TouchableOpacity onPress={() => setMode('idle')}>
          <Text style={styles.hint}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (mode === 'confirm' && pending) {
    return (
      <View style={styles.card}>
        <Text style={styles.h3}>
          {pending.verified ? '🛬 Welcome to Maui!' : '🛬 Almost there'}
        </Text>
        <Text style={styles.line}>
          <Text style={styles.bold}>{airportCity(pending.from)}</Text> → Maui
          {pending.dateISO ? ` · arriving ${prettyDate(pending.dateISO)}` : ''}
        </Text>
        <Text style={styles.hint}>
          Flights connect — if {airportCity(pending.from)} isn't home, just pick your language:
        </Text>
        <LanguagePicker value={pending.lang} onChange={(lang) => setPending({ ...pending, lang })} />
        <TouchableOpacity style={styles.cta} disabled={busy} onPress={save}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Join the ohana</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setPending(null); setMode('idle'); }}>
          <Text style={styles.hint}>Start over</Text>
        </TouchableOpacity>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    );
  }

  if (mode === 'manual') {
    return (
      <View style={styles.card}>
        <Text style={styles.h3}>✈️ Where are you flying from?</Text>
        <TextInput
          style={styles.input}
          placeholder="Airport code (e.g. KIX)"
          autoCapitalize="characters"
          maxLength={3}
          value={manualCode}
          onChangeText={setManualCode}
        />
        <TouchableOpacity style={[styles.cta, manualCode.trim().length !== 3 && styles.ctaOff]} onPress={useManual}>
          <Text style={styles.ctaText}>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMode('idle')}>
          <Text style={styles.hint}>Back</Text>
        </TouchableOpacity>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.h3}>✈️ Traveling to Maui?</Text>
      <Text style={styles.line}>
        Scan your boarding pass to verify you're a traveler — we'll greet you in the language of home and match you with your first cause.
      </Text>
      <TouchableOpacity style={styles.cta} onPress={startScan}>
        <Text style={styles.ctaText}>Scan boarding pass</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => { setError(null); setMode('manual'); }}>
        <Text style={styles.hint}>No pass handy? Enter your airport instead</Text>
      </TouchableOpacity>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}
