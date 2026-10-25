import { useState } from "react";
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
import { DemoModal } from "../components/demo/DemoModal";

export function Landing() {
  const [demoOpen, setDemoOpen] = useState(false);

  return (
    <div className="signal">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SignalNav onOpenDemo={() => setDemoOpen(true)} />
      <main id="main-content">
        <SignalHero onOpenDemo={() => setDemoOpen(true)} />
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
      <DemoModal isOpen={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
}
