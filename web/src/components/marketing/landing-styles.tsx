/*
  The landing page's own CSS: the one orchestrated motion of section 16. On load the gold thread
  draws from the explorer's txid across to the key's txid (a dot at each end), then each private value on the paper
  side resolves from a Mist bar into its value, top to bottom. Values are in the markup from the
  start (screen readers and reduced motion get the final state at once); only the bars and the
  fade are animated, and only when the visitor has not asked for reduced motion.

  The rules ship as one inline <style> that React hoists into <head>, so the landing page makes no
  stylesheet request of its own before first paint. Class names are in classes.ts.
*/

const CSS = `
/* The landing page wears only the identity faces, the skip link included. */
body:has(.identity) {
  font-family: var(--font-text);
}
@media (prefers-reduced-motion: no-preference) {
  .lp-thread {
    transform-origin: left center;
    animation: lp-draw 520ms cubic-bezier(0.55, 0, 0.25, 1) 240ms both;
  }
  .lp-thread-paper {
    animation-duration: 200ms;
    animation-delay: 760ms;
    animation-timing-function: linear;
  }
  /* The dots land where the thread meets each txid: the explorer's as it starts, the key's as it arrives. */
  .lp-dot {
    animation: lp-pop 260ms cubic-bezier(0.3, 1.4, 0.5, 1) 180ms both;
  }
  .lp-dot-paper {
    animation-delay: 920ms;
  }
  .lp-reveal {
    position: relative;
  }
  .lp-reveal > .lp-v {
    animation: lp-fade 380ms ease-out calc(var(--lp-delay, 1000ms) + 220ms) both;
  }
  .lp-reveal::after {
    content: "";
    position: absolute;
    inset: 0.14em 0;
    border-radius: 4px;
    background: var(--id-mist);
    transform-origin: right center;
    animation: lp-unbar 560ms cubic-bezier(0.65, 0, 0.35, 1) var(--lp-delay, 1000ms) both;
  }
}
@keyframes lp-draw {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
@keyframes lp-pop {
  from {
    transform: scale(0);
  }
}
@keyframes lp-unbar {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}
@keyframes lp-fade {
  from {
    opacity: 0;
  }
}
`;

export function LandingStyles() {
  return (
    <style href="payslip-landing" precedence="medium">
      {CSS}
    </style>
  );
}
