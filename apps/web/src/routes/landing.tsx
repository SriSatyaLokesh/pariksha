// The landing page, on the Signal direction.
// `.planning/landing/signal-reference.html` is the prototype; its spine is
// nine movements of deliberately unequal weight rather than a stack of
// identical bands: an ink hero carrying a live pool draw, the type rail,
// the captured screens, the anti-form argument, the integrity ethic on its
// own ground, the cost arithmetic, the comparison, the build status, the
// FAQ and the close.
//
// The screens band (issue 253) goes directly after the type rail, so the
// claim ("twelve question types") and its proof (the paper, the builder,
// the bank, the analytics) sit together rather than a scroll apart.
import { SignalHero, SignalNav, SignalTypeRail } from "../sections/signal/Head";
import { SignalScreens } from "../sections/signal/Screens";
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
        <SignalScreens />
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
