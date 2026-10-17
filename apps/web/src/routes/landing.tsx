// Landing page v2 — the full assembly.
// docs/superpowers/specs/2026-10-17-landing-page-v2-design.md.
// Every section is its own component (§3.0, §6); this file only wires
// TopNav, the skip link, the one <main> landmark and the twelve sections in
// the order §3.0's spine table fixes, plus the footer landmark after it.
import { TopNav } from "../components/TopNav";
import { Hero } from "../sections/s1-s3/Hero";
import { WhatIsPariksha } from "../sections/s1-s3/WhatIsPariksha";
import { HowItWorks } from "../sections/s1-s3/HowItWorks";
import { S4Comparison } from "../sections/s4-s6/S4Comparison";
import { S5Features } from "../sections/s4-s6/S5Features";
import { S6NoCode } from "../sections/s4-s6/S6NoCode";
import { CostSection } from "../sections/s7-s9/CostSection";
import { NotForSection } from "../sections/s7-s9/NotForSection";
import { StatusSection } from "../sections/s7-s9/StatusSection";
import { Faq } from "../sections/s10-s12/Faq";
import { Closing } from "../sections/s10-s12/Closing";
import { Footer } from "../sections/s10-s12/Footer";

export function Landing() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <TopNav />
      <main id="main-content">
        <Hero />
        <WhatIsPariksha />
        <HowItWorks />
        <S4Comparison />
        <S5Features />
        <S6NoCode />
        <CostSection />
        <NotForSection />
        <StatusSection />
        <Faq />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
