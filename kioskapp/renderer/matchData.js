// Test local profiles + sponsor experience database for the match wheel.
//
// Locals are demo profiles: their portraits are generated on Masky wearing
// visibly branded outfits (so the same VLM that reads the visitor can read
// the card) and live in the site media bucket under
// `${MEDIA_BASE}/locals/<id>.jpg` — never in git (see CLAUDE.md "Site media").
// Tags mirror the brandSense report shape so the matcher compares like with
// like. Replacing these with real community profiles from the agentharness
// store is the post-hackathon step.

export const LOCALS = [
  {
    id: 'leilani',
    name: 'Leilani',
    gender: 'female',
    blurb: 'Lahaina surf coach — happiest where the reef meets the morning light.',
    brands: ['Roxy', 'Billabong'],
    styles: ['surfwear', 'beachwear'],
    colors: ['teal', 'white'],
    accessories: ['lei', 'sunglasses'],
  },
  {
    id: 'kai',
    name: 'Kai',
    gender: 'male',
    blurb: 'Outrigger paddler and shave-ice connoisseur from Wailuku.',
    brands: ['Quiksilver', 'Hurley'],
    styles: ['boardshorts', 'surfwear'],
    colors: ['blue', 'black'],
    accessories: ['hat', 'backpack'],
  },
  {
    id: 'noelani',
    name: 'Noelani',
    gender: 'female',
    blurb: 'Upcountry trail runner who knows every banyan on the island.',
    brands: ['Nike', 'Patagonia'],
    styles: ['athleisure', 'activewear'],
    colors: ['black', 'coral'],
    accessories: ['headphones', 'cap'],
  },
  {
    id: 'makoa',
    name: 'Makoa',
    gender: 'male',
    blurb: 'Slack-key guitarist; plays sunset sets at the Lahaina harbor.',
    brands: ['RVCA', 'Vans'],
    styles: ['aloha shirt', 'casual'],
    colors: ['red', 'cream'],
    accessories: ['lei', 'ukulele'],
  },
  {
    id: 'kehlani',
    name: 'Kehlani',
    gender: 'female',
    blurb: 'Lei maker and hula teacher — her plumeria garden smells like aloha.',
    brands: ['Lululemon'],
    styles: ['aloha dress', 'athleisure'],
    colors: ['pink', 'green'],
    accessories: ['lei', 'flower'],
  },
  {
    id: 'ikaika',
    name: 'Ikaika',
    gender: 'male',
    blurb: 'Freediver and coffee farmer splitting weeks between Hana and Kula.',
    brands: ['Patagonia', 'O’Neill'],
    styles: ['outdoor', 'casual'],
    colors: ['green', 'navy'],
    accessories: ['watch', 'hat'],
  },
];

// Sponsor experiences the wheel can land on. `short` fits a wheel segment.
export const EXPERIENCES = [
  { id: 'snorkel-sail', short: 'Snorkel Sail', title: 'Morning snorkel sail to Honolua Bay' },
  { id: 'luau', short: 'Lūʻau Night', title: 'Oceanfront lūʻau dinner for two' },
  { id: 'surf-lesson', short: 'Surf Lesson', title: 'Beginner surf lesson at Launiupoko' },
  { id: 'coffee-tour', short: 'Coffee Farm', title: 'Kula coffee farm tasting tour' },
  { id: 'sunset-sail', short: 'Sunset Sail', title: 'Catamaran sunset sail off Kāʻanapali' },
  { id: 'lei-workshop', short: 'Lei Making', title: 'Fresh-flower lei making workshop' },
  { id: 'shave-ice', short: 'Shave Ice', title: 'Shave ice crawl through Pāʻia town' },
  { id: 'ukulele', short: 'ʻUkulele Hour', title: 'Group ʻukulele lesson on the beach' },
];
