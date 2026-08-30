// "Join the Aloha Circle" — the OGG baggage-claim experience: travelers are
// greeted by kiʻi of the Hawaiian akua, and a small donation opens the
// experience (pick a Hawaiian term, join its virtual representation).
// Video: experience-area walkthrough with the kiʻi avatar explainer overlay
// (top-right). Portrait 9:16 — display the full frame, never crop, or the
// avatar overlay gets cut off.
const CIRCLE_VIDEO =
  'https://buzz.masky.ai/media/af6317556ffba70e968c6e7672ce2b454b809cf479f56c5f64ce90637e4b1c7f.mp4';

export function AlohaCircle() {
  return (
    <section className="aloha-circle" id="aloha-circle">
      <p className="causes-title">Join the Aloha Circle</p>
      <div className="circle-row">
        <div className="circle-copy">
          <h2>You'll be greeted by the Hawaiian akua at baggage claim</h2>
          <p>
            Land at Kahului Airport (OGG) and the Aloha Circle is waiting right in the
            baggage-claim experience area — where kiʻi of the Hawaiian akua welcome you
            to the island. A small donation joins you to our ohana: choose a Hawaiian
            term to learn, then step into a virtual representation of it and carry its
            meaning with you across Maui.
          </p>
          <p className="hint">
            Watch the walkthrough — you will choose one of the four main akua to guide
            you through an augmented reality experience. Guests that point their phones
            at this space will see you and the spirits of Hawaiʻi moving as one.
          </p>
        </div>
        <video
          className="circle-video"
          src={CIRCLE_VIDEO}
          controls
          playsInline
          preload="metadata"
        />
      </div>
    </section>
  );
}
