import { useState, useEffect } from "react";
import type { PaperSection } from "../../lib/paper";

export interface SectionNavProps {
  sections: PaperSection[];
  activeSectionIndex: number;
  navigation: "free" | "linear" | "per_section";
  onSelectSection: (sectionIndex: number) => void;
  sectionRemainingMs?: number | null;
}

export function SectionNav({
  sections,
  activeSectionIndex,
  navigation,
  onSelectSection,
  sectionRemainingMs,
}: SectionNavProps) {
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  const activeSection = sections[activeSectionIndex];

  // Close drawer if user presses Escape key
  useEffect(() => {
    if (!instructionsOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setInstructionsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [instructionsOpen]);

  if (!sections || sections.length === 0 || !activeSection) {
    return null;
  }

  // Question count text
  const questionCount = activeSection.questions.length;
  const countText = `${questionCount} ${questionCount === 1 ? "question" : "questions"}`;

  // Time limit / countdown text
  let timeText: string | null = null;
  if (sectionRemainingMs != null) {
    const mins = Math.max(0, Math.ceil(sectionRemainingMs / 60_000));
    timeText = `${mins} min left`;
  } else if (activeSection.timeLimitMinutes != null) {
    timeText = `${activeSection.timeLimitMinutes} min limit`;
  }

  return (
    <div className="exam-section-nav">
      <div className="exam-section-tabs" role="tablist" aria-label="Exam Sections">
        {sections.map((section, idx) => {
          const isActive = idx === activeSectionIndex;
          const isPast = idx < activeSectionIndex;
          const isFuture = idx > activeSectionIndex;

          let isDisabled = false;
          let isLocked = false;

          if (navigation === "linear") {
            // Linear navigation: tabs are display-only (no skipping)
            isDisabled = !isActive;
          } else if (navigation === "per_section") {
            // Per section navigation: past sections are locked, future are disabled
            if (isPast) {
              isLocked = true;
              isDisabled = true;
            } else if (isFuture) {
              isDisabled = true;
            }
          }

          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              id={`section-tab-${section.id}`}
              aria-selected={isActive ? "true" : "false"}
              disabled={isDisabled}
              className={[
                "exam-button",
                "exam-section-tab",
                isActive ? "is-active" : "",
                isLocked ? "is-locked" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => {
                if (!isDisabled) {
                  onSelectSection(idx);
                }
              }}
            >
              {section.title} ({section.questions.length})
              {isLocked ? " [Locked]" : ""}
            </button>
          );
        })}
      </div>

      <div className="exam-section-header">
        <div className="exam-section-info">
          <h2 className="exam-section-title">{activeSection.title}</h2>
          <div className="exam-section-meta">
            <span className="exam-section-count">{countText}</span>
            {timeText && <span className="exam-section-limit">{timeText}</span>}
          </div>
        </div>

        {activeSection.instructions && (
          <button
            type="button"
            className="exam-button exam-section-instructions-toggle"
            aria-label="Section instructions"
            aria-expanded={instructionsOpen}
            onClick={() => setInstructionsOpen((open) => !open)}
          >
            Section instructions
          </button>
        )}
      </div>

      {instructionsOpen && activeSection.instructions && (
        <div
          className="exam-section-drawer"
          role="dialog"
          aria-label="Section instructions"
        >
          <div className="exam-section-drawer-header">
            <h3 className="exam-section-drawer-title">Instructions — {activeSection.title}</h3>
            <button
              type="button"
              className="exam-button exam-section-drawer-close"
              aria-label="Close instructions"
              onClick={() => setInstructionsOpen(false)}
            >
              Close
            </button>
          </div>
          <div className="exam-section-drawer-body">
            <p>{activeSection.instructions}</p>
          </div>
        </div>
      )}
    </div>
  );
}
