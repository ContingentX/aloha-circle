// Featured Maui nonprofits for the landing scroller. Static so the prod S3
// site never shows an empty rail; the agentharness seed (fixtures/seed.json)
// mirrors these orgs for matching + endorsements.
// video: optional avatar explainer shown in the cause modal.
export const FEATURED_NONPROFITS = [
  {
    id: 'treecovery',
    name: 'Treecovery Hawaiʻi',
    tagline: 'Free trees for Lāhainā & Kula fire survivors',
    blurb:
      'Founded by landscaper Duane Sparkman after the August 2023 wildfires, Treecovery grows trees in nurseries across Maui and gives them free to every family that lost theirs — replanting shade, fruit and hope for the next generation.',
    causeTags: ['trees', 'aina', 'wildfire-recovery'],
    website: 'https://treecoveryhawaii.org/',
    experience: 'Plant a tree in Lāhainā side-by-side with Duane’s crew',
    emoji: '🌳',
    grad: ['#1c7c54', '#0b5d8a'],
    image: 'https://buzz.masky.ai/media/57e031fea6210ebea0a85d4b4ca98bedb7b4ed5d3687589e7358f94dfcbc5a6e.png',
    // Founder avatar explainer (Masky render of Duane, hosted on buzz media)
    video: 'https://buzz.masky.ai/media/261afba7315d6687757a6601c9d55643b14c91790b6702d240d2d9110f5402b4.mp4',
  },
  {
    id: 'hua-momona',
    name: 'Hua Momona Farms',
    tagline: '100,000+ hot meals for Lāhainā fire survivors',
    blurb:
      'Born of the Grube family’s farming heritage and love for Hawaiʻi, the Hua Momona Foundation has proudly served over 100,000 hot meals to those impacted by the August 8, 2023 Lāhainā fires — and hosts plated farm dinners by celebrity chef Zack Laidlaw.',
    causeTags: ['food-security', 'farming', 'wildfire-recovery'],
    website: 'https://www.huamomonafarms.com/',
    experience: 'Plated dinner for your group of up to 40 by celebrity chef Zack Laidlaw',
    emoji: '🥬',
    grad: ['#7cb342', '#1c7c54'],
    image: 'https://buzz.masky.ai/media/788ab71cc91c09799d25f468f5a59f65aa7c4fc21ed3e7d7fdc359c08ae0682d.png',
    // Founder avatar explainer (Masky render of Gary Grube, hosted on buzz media)
    video: 'https://buzz.masky.ai/media/a5d3970b0fab0a3cd837734f23917b4471fb8aac42628864b6d191eb755122c7.mp4',
  },
  {
    id: 'maui-humane',
    name: 'Maui Humane Society',
    tagline: 'Beach days for shelter dogs',
    blurb:
      'Maui’s only open-admission shelter cares for the island’s animals — including pets displaced by the wildfires. Their Beach Buddies program lets visitors take a shelter dog out for a beach day.',
    causeTags: ['animals', 'family'],
    website: 'https://www.mauihumanesociety.org/',
    experience: 'Beach Buddies: a morning at the beach with a shelter pup',
    emoji: '🐕',
    grad: ['#ff6b57', '#ffd166'],
  },
  {
    id: 'hawaii-wildlife-fund',
    name: 'Hawaiʻi Wildlife Fund',
    tagline: 'Sea turtle patrols & marine debris cleanups',
    blurb:
      'Field biologists and volunteers protect hawksbill sea turtles, monk seals and coastal habitat across Maui — dawn nest patrols run May through October.',
    causeTags: ['wildlife', 'ocean', 'reef'],
    website: 'https://www.wildhawaii.org/',
    experience: 'Dawn sea-turtle patrol alongside a field biologist',
    emoji: '🐢',
    grad: ['#0b5d8a', '#073b57'],
  },
  {
    id: 'kipuka-olowalu',
    name: 'Kīpuka Olowalu',
    tagline: 'Taro patch & native restoration in Olowalu Valley',
    blurb:
      'Restores loʻi kalo (taro patches) and native ecosystems in Olowalu Valley — volunteers pull invasives, plant natives and learn the moʻolelo of the valley.',
    causeTags: ['aina', 'farming', 'culture'],
    website: 'https://kipukaolowalu.org/',
    experience: 'Work a centuries-old taro patch, feet in the mud',
    emoji: '🌱',
    grad: ['#1c7c54', '#ffd166'],
  },
  {
    id: 'maui-cultural-lands',
    name: 'Maui Cultural Lands',
    tagline: 'Restoring Hawaiian cultural sites since 2002',
    blurb:
      'Led by the Lindsey ʻohana, volunteers restore taro terraces and cultural sites in Honokōwai Valley every Saturday — hiking in with locals who grew up on this land.',
    causeTags: ['culture', 'trails', 'aina'],
    website: 'https://www.mauiculturallands.org/',
    experience: 'Saturday valley hike + hands-on restoration with the ʻohana',
    emoji: '🌺',
    grad: ['#b3477d', '#ff6b57'],
  },
  {
    id: 'surfrider-maui',
    name: 'Surfrider Foundation Maui',
    tagline: 'Monthly beach cleanups with real data',
    blurb:
      'The Maui chapter runs monthly beach cleanups where every piece of marine debris is logged as conservation data — the easiest first step into Maui’s ocean community.',
    causeTags: ['ocean', 'reef', 'community'],
    website: 'https://maui.surfrider.org/',
    experience: 'Sunrise beach cleanup + reef-safe talk-story',
    emoji: '🌊',
    grad: ['#0b5d8a', '#1c7c54'],
  },
  {
    id: 'maui-food-bank',
    name: 'Maui Food Bank',
    tagline: 'Feeding Maui County families',
    blurb:
      'Distributes food to thousands of Maui residents every month — volunteers sort, pack and deliver alongside locals who know exactly where the need is.',
    causeTags: ['food-security', 'community'],
    website: 'https://mauifoodbank.org/',
    experience: 'Pack family food boxes shoulder-to-shoulder with locals',
    emoji: '🥭',
    grad: ['#ffd166', '#ff6b57'],
  },
  {
    id: 'habitat-maui',
    name: 'Habitat for Humanity Maui',
    tagline: 'Rebuilding homes in Lāhainā',
    blurb:
      'Building and repairing homes for Maui families — construction volunteers are working right now on the Lāhainā rebuild.',
    causeTags: ['community', 'rebuilding'],
    website: 'https://www.habitat-maui.org/',
    experience: 'Swing a hammer on a Lāhainā rebuild day',
    emoji: '🏠',
    grad: ['#073b57', '#ff6b57'],
  },
];
