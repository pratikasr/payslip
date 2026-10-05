/*
  Landing page art. Mercury opens on a landscape photo at dusk; Payslip paints the same hour in
  CSS and one inline SVG (no images): a violet sky warming to a gold horizon, three ridges of
  hills in haze, and the dark product section rising out of the last one.

  The rules ship as one inline <style> that React hoists into <head>, so the landing page makes no
  stylesheet request of its own before first paint (Lighthouse, mobile: first paint 1.6 s with a
  separate CSS module, 1.2 s inline). Class names are in classes.ts.
*/

const CSS = `
/* Phones keep the header fixed at the top; anchors land below it. */
@media (max-width: 767px) {
  html {
    scroll-padding-top: 72px;
  }
}
.lp-sky {
  background:
    radial-gradient(38% 26% at 50% 70%, rgba(244, 183, 40, 0.5), transparent 72%),
    radial-gradient(70% 34% at 50% 74%, rgba(236, 150, 84, 0.34), transparent 70%),
    radial-gradient(60% 50% at 10% 14%, rgba(124, 96, 150, 0.55), transparent 70%),
    radial-gradient(55% 50% at 92% 20%, rgba(66, 80, 146, 0.55), transparent 70%),
    linear-gradient(
      180deg,
      #191829 0%,
      #262139 22%,
      #3b2d4c 44%,
      #6a4655 60%,
      #a86d55 70%,
      #c98e58 75%,
      #3a2a3c 86%,
      #171721 100%
    );
}

/* Faint vertical lines, like light through haze over the valley. */
.lp-rays {
  background: repeating-linear-gradient(90deg, transparent 0 79px, rgba(255, 255, 255, 0.035) 79px 80px);
  mask-image: linear-gradient(180deg, transparent 40%, #000 72%, transparent 96%);
}

/* The sealed amount: a gold bar. On load a light passes over it once. */
.lp-bar {
  position: relative;
  overflow: hidden;
  display: block;
  height: 10px;
  border-radius: 3px;
  background: linear-gradient(90deg, rgba(244, 183, 40, 0.62), rgba(244, 183, 40, 0.2));
}
/* On a light card the bar needs more gold to read. */
.lp-on-light {
  background: linear-gradient(90deg, var(--primary-edge), rgba(244, 183, 40, 0.3));
}
@media (prefers-reduced-motion: no-preference) {
  .lp-bar::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255, 244, 214, 0.55), transparent);
    transform: translateX(-110%);
    animation: lp-sheen 1100ms cubic-bezier(0.4, 0, 0.2, 1) var(--sheen-delay, 600ms) 1 both;
  }
}
@keyframes lp-sheen {
  to {
    transform: translateX(110%);
  }
}

/*
  Accordion panel: the height eases open (grid rows 0fr to 1fr). A closed panel is also
  visibility: hidden once it has closed, so its links leave the tab order and the reading order.
*/
.lp-panel {
  display: grid;
  grid-template-rows: 0fr;
  visibility: hidden;
  transition:
    grid-template-rows 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
    visibility 0s linear 320ms;
}
.lp-panel[data-open] {
  grid-template-rows: 1fr;
  visibility: visible;
  transition:
    grid-template-rows 320ms cubic-bezier(0.2, 0.7, 0.2, 1),
    visibility 0s;
}
@media (prefers-reduced-motion: reduce) {
  .lp-panel,
  .lp-panel[data-open] {
    transition: none;
  }
}

/* The product card on the right swaps with a short cross-fade. */
.lp-slide {
  grid-area: 1 / 1;
  opacity: 0;
  visibility: hidden;
  transform: translateY(6px);
  transition:
    opacity 260ms ease,
    transform 360ms cubic-bezier(0.2, 0.7, 0.2, 1),
    visibility 0s linear 260ms;
}
.lp-slide[data-active] {
  opacity: 1;
  visibility: visible;
  transform: none;
  transition:
    opacity 260ms ease 80ms,
    transform 360ms cubic-bezier(0.2, 0.7, 0.2, 1) 80ms,
    visibility 0s;
}
@media (prefers-reduced-motion: reduce) {
  .lp-slide,
  .lp-slide[data-active] {
    transition: none;
    transform: none;
  }
}

/* The plate the product card sits on, fading out at the bottom like Mercury's app window. */
.lp-plate {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.01) 70%, transparent);
  mask-image: linear-gradient(180deg, #000 78%, transparent);
}

/* Closing band: the same horizon, seen from further away. */
.lp-horizon {
  background:
    radial-gradient(46% 60% at 50% 118%, rgba(244, 183, 40, 0.32), transparent 70%),
    radial-gradient(80% 70% at 50% 130%, rgba(168, 109, 85, 0.35), transparent 70%);
}
`;

export function LandingStyles() {
  return (
    <style href="payslip-landing" precedence="medium">
      {CSS}
    </style>
  );
}
