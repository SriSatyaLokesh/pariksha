// The landing page, on the Signal direction.
// `.planning/landing/signal-reference.html` is the prototype; its spine is
// eight movements of deliberately unequal weight rather than a stack of
// identical bands: an ink hero carrying a live pool draw, the type rail,
// the anti-form argument, the integrity ethic on its own ground, the cost
// arithmetic, the comparison, the build status, the FAQ and the close.
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
