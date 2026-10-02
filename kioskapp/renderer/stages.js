// Stage definitions for the Breath of Aloha ritual flow.
// Each avatar `clip` resolves to assets/clips/<clip>.mp4 locally, with a
// remote fallback at MEDIA_BASE (see config.js) so a fresh checkout still runs.

export const STAGES = [
  {
    id: 'attract',
    kind: 'attract',
    title: 'The Breath of Aloha',
    subtitle: 'E komo mai — welcome to the Aloha Circle',
    instruction: 'Put on the headphones, stand in the circle, and touch the Begin button.',
    button: 'Begin',
  },
  {
    id: 'welcome',
    kind: 'avatar',
    title: 'Meet Kanaloa',
    clip: 'welcome',
    instruction: 'Kanaloa is welcoming you — listen with your headphones.',
    detect: 'gaze_at_screen', // future: auto-play when the visitor looks at the screen
    button: 'I’m ready',
  },
  {
    id: 'honi',
    kind: 'hold',
    title: 'Honi Ihu — the greeting of breath',
    clip: 'honi',
    instruction:
      'Lean in and gently touch your forehead to Kanaloa’s. Hold and breathe together for five seconds.',
    holdSeconds: 5,
    detect: 'forehead_touch',
    button: 'Touch foreheads',
  },
  {
    id: 'eyes',
    kind: 'gesture',
    emoji: '\u{1F441}️',
    title: 'The Eyes',
    clip: 'eyes',
    instruction:
      'Gently cover or touch your eyelids. Bless your eyes to see the beauty in the world, and to view others with compassion.',
    detect: 'hands_over_eyes',
    button: 'Next',
  },
  {
    id: 'ears',
    kind: 'gesture',
    emoji: '\u{1F442}',
    title: 'The Ears',
    clip: 'ears',
    instruction:
      'Place your hands over your ears. Set the intention to listen carefully, tune into your inner wisdom, and block out negativity.',
    detect: 'hands_over_ears',
    button: 'Next',
  },
  {
    id: 'nose',
    kind: 'gesture',
    emoji: '\u{1F443}',
    title: 'The Nose',
    clip: 'nose',
    instruction:
      'Gently touch your nose, bringing awareness to the hā — the breath of life. Inhale goodness; release what no longer serves you.',
    detect: 'hand_near_nose',
    button: 'Next',
  },
  {
    id: 'heart',
    kind: 'gesture',
    emoji: '❤️',
    title: 'The Heart',
    clip: 'heart',
    instruction:
      'Stack both hands over your chest. From my heart to your heart — extend unconditional love, empathy, and peace into the world.',
    detect: 'hands_on_heart',
    button: 'Next',
  },
  {
    id: 'mahalo',
    kind: 'closing',
    title: 'Mahalo nui loa',
    clip: 'mahalo',
    instruction: 'A hui hou — until we meet again.',
    button: 'Start over',
  },
];
