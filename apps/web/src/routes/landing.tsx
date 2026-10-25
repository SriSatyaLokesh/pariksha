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
