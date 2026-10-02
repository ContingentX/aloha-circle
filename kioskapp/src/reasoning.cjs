// CoreWeave reasoning hook (W&B Inference, OpenAI-compatible).
//
// The key lives in SSM at /alohaintelligence/production/coreweave_api_key —
// export it as COREWEAVE_API_KEY before launching the kiosk. Never commit it.
//   aws ssm get-parameter --name /alohaintelligence/production/coreweave_api_key \
//     --with-decryption --query Parameter.Value --output text
//
// Used for in-experience reasoning: e.g. composing a personalized closing
// blessing from what the visitor shared, or adapting coaching lines when the
// pose detector sees the visitor struggling with a stage.

const ENDPOINT = 'https://api.inference.wandb.ai/v1/chat/completions';
const MODEL = process.env.COREWEAVE_MODEL || 'meta-llama/Llama-3.1-8B-Instruct';

const FALLBACK =
  'Mahalo for sharing your breath with me today. Carry the aloha in your heart across the island.';

async function askReasoner(prompt) {
  const key = process.env.COREWEAVE_API_KEY;
  if (!key) return { text: FALLBACK, source: 'fallback' };
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 120,
        messages: [
          {
            role: 'system',
            content:
              'You are Kanaloa, a gentle Hawaiian water-spirit girl guiding the Breath of Aloha ritual at the Aloha Circle in Maui. Reply with one or two warm, simple spoken sentences.',
          },
          { role: 'user', content: String(prompt).slice(0, 500) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`reasoner ${res.status}`);
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content?.trim();
    return text ? { text, source: 'coreweave' } : { text: FALLBACK, source: 'fallback' };
  } catch (err) {
    console.error('reasoning fallback:', err.message);
    return { text: FALLBACK, source: 'fallback' };
  }
}

module.exports = { askReasoner };
