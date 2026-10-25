// The landing page, on the Signal direction.
// `.planning/landing/signal-reference.html` is the prototype; its spine is
// eight movements of deliberately unequal weight rather than a stack of
// identical bands: an ink hero carrying a live pool draw, the type rail,
// the anti-form argument, the integrity ethic on its own ground, the cost
// arithmetic, the comparison, the build status, the FAQ and the close.
//
// **No screenshot band.** Issue 253 added one — five captured screens in a
// grid directly after the type rail — and the owner cut it on sight: a row
// of desktop screenshots shrunk into a page column is a catalogue, not an
// argument, and at phone width each one measured 342px wide with nothing
// in it legible. The captures still exist and still earn their place, in
// the README, where they are read at full width beside the prose that
// explains them. This page keeps the one picture a screenshot cannot
// take: the hero's live pool draw.
import { SignalHero, SignalNav, SignalTypeRail } from "../sections/signal/Head";
import {
  SignalCompare,
  SignalCost,
  SignalIntegrity,
  SignalNotAForm,
} from "../sections/signal/Body";
import {
  SignalClose,
  SignalFaq,
  SignalFooter,
  SignalStatus,
} from "../sections/signal/Tail";

export function Landing() {
  return (
    <div className="signal">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SignalNav />
      <main id="main-content">
        <SignalHero />
        <SignalTypeRail />
        <SignalNotAForm />
        <SignalIntegrity />
        <SignalCost />
        <SignalCompare />
        <SignalStatus />
        <SignalFaq />
        <SignalClose />
      </main>
      <SignalFooter />
    </div>
  );
}
