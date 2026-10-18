import {useEffect, useId, useRef} from 'react';
import {audienceOptions} from '../app/audience';
import {useWorkspace} from '../app/state';

export function AudienceOnboarding() {
  const setAudience = useWorkspace(state => state.setAudience);
  const id = useId(), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    return () => document.querySelector<HTMLButtonElement>('button[aria-label="Open search"]')?.focus();
  },[]);
  return <div className="audience-onboarding" role="dialog" aria-modal="true" aria-labelledby={`${id}-heading`} aria-describedby={`${id}-description`}
    onKeyDown={event => {
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); setAudience('general_public');}
      if (event.key === 'Tab') {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && (document.activeElement === first || !buttons.includes(document.activeElement as HTMLButtonElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !buttons.includes(document.activeElement as HTMLButtonElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    }}>
    <div className="audience-onboarding-card">
      <h2 ref={heading} tabIndex={-1} id={`${id}-heading`}>How will you use Atlas?</h2>
      <p className="muted" id={`${id}-description`}>Choose a perspective. Everyone gets the same facts and sources.</p>
      <div className="audience-options">
        {audienceOptions.map(option => <button key={option.id} onClick={() => setAudience(option.id)}>
          <strong>{option.label}</strong><span>{option.emphasis}</span>
        </button>)}
      </div>
      <button className="text-button audience-skip" onClick={() => setAudience('general_public')}>Skip for now</button>
      <p className="muted">Saved on this browser. No account needed.</p>
    </div>
  </div>;
}
