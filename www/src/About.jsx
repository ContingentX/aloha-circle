// /about — standalone page: the explainer film + what Aloha Circle is.
// The video ships via the site buckets' media/ prefix (see CLAUDE.md), not git.
export function About() {
  return (
    <div className="about-page">
      <header className="about-header">
        <a className="brand" href="/">
          <img className="brand-logo" src="/aloha-circle-logo.svg" alt="" />
          <span>Aloha Circle</span>
        </a>
        <a className="about-home-link" href="/">aloha-circle.com</a>
      </header>

      <main className="about-main">
        <h1>Don&rsquo;t just visit Maui. Meet Maui.</h1>
        <p className="about-lede">
          Watch how one family&rsquo;s arrival at Kahului Airport becomes a donation to a live
          Maui cause, a playful ritual with Kanaloa, and a real friendship with a local.
        </p>

        <video
          className="about-video"
          src="/media/explainer.mp4"
          poster="/media/explainer-poster.jpg"
          controls
          playsInline
          preload="metadata"
        />

        <section className="about-copy">
          <h2>What is Aloha Circle?</h2>
          <p>
            Aloha Circle turns a Maui vacation into a relationship with Maui. A QR banner at
            baggage claim starts your aloha with a donation to a live local cause. At the Aloha
            Circle kiosk, keiki and adults complete the Breath of Aloha — a camera-guided ritual
            led by Kanaloa, our water-spirit guide — then spin the Wheel of Aloha to win a
            sponsor-donated experience and meet the Maui local whose style best matches theirs.
          </p>
          <p>
            Behind it, the Aloha Agent continuously ingests a Maui Needs Index of local causes
            and recomputes matches between travelers, locals, nonprofits, and donated
            experiences — so every visit ends in a real action: money to a cause, and a traveler
            and a local actually meeting.
          </p>
          <h2>Sponsors make the wheel</h2>
          <p>
            Local businesses donate the experiences on the wheel — helicopter tours, dinners,
            excursions — and get brand placement in the kiosk and on this site. The build is
            powered by VAST Data, NVIDIA Cosmos, W&amp;B Inference by CoreWeave, Roboflow, and
            Masky avatars.
          </p>
        </section>
      </main>
    </div>
  );
}
