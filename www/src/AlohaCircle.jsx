// "Join the Aloha Circle" — the OGG baggage-claim experience: travelers are
// greeted by kiʻi of the Hawaiian akua, and a small donation opens the
// experience (pick a Hawaiian term, join its virtual representation).
// Video: experience-area walkthrough with the kiʻi avatar explainer overlay.
const CIRCLE_VIDEO =
  'https://buzz.masky.ai/media/032f69c54a1228aec6ff685f9036214d0205f9268074f57e28854f7b7c097d11.mp4';

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
            Watch the walkthrough — the kiʻi guide explains how voluntourism through the
            Aloha Circle works.
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
