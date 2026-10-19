import { MonoCaption } from "./MonoCaption";

// Fix round (whole-branch review, C1): every authoring screen `organiser.tsx`
// switches to needs the same chrome `Dashboard` already had — a way back
// and a way to sign out — or reaching one is a one-way trip. Extracted here
// once four screens (Dashboard, BankList, BankBrowser, QuestionScreen) need
// it identically, rather than copied four times.
export function OrganiserHeader({
  email,
  onSignOut,
  onBack,
  backLabel,
}: {
  email: string;
  onSignOut: () => void;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <header className="organiser-bar">
      <p className="organiser-bar__mark">Pariksha</p>
      <div className="organiser-bar__actions">
        {onBack && (
          <button type="button" className="button-secondary" onClick={onBack}>
            {backLabel ?? "Back"}
          </button>
        )}
        <MonoCaption>{email}</MonoCaption>
        <button type="button" className="button-secondary" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
