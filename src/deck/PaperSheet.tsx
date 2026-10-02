import { useEffect, useState, type ReactNode } from 'react';

/** How long the sheet takes to roll back up. Mirrors `--paper-close` in builder.css. */
const CLOSE_MS = 240;

/** Whether the tab is tucked away is the visitor's choice, so it outlives the visit. */
const TUCKED_KEY = 'four-quarters:tab-tucked';

function readTucked(): boolean {
  try {
    return window.localStorage.getItem(TUCKED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeTucked(tucked: boolean): void {
  try {
    if (tucked) window.localStorage.setItem(TUCKED_KEY, '1');
    else window.localStorage.removeItem(TUCKED_KEY);
  } catch {
    // A private window that refuses storage just forgets the choice.
  }
}

/**
 * The one sheet of paper over the scene.
 *
 * Closed, it is clipped down to a tab sticking out of the right edge of the screen:
 * a small arrow, then "Make your own". Pressing the lettering unrolls the SAME sheet
 * into the builder, so the tab is not a button that summons a panel, it is the corner
 * of the panel.
 *
 * The arrow pushes the tab out of the way: it slides off the edge until only the
 * arrow's sliver of paper is left. That sliver brings it back when pressed, and with
 * a mouse the tab also slides out under the pointer for as long as it is there.
 *
 * The motion is `clip-path` plus one transform, both transitions (builder.css), so
 * they retarget from wherever they are if pressed again mid-move, and a clipped
 * region takes no pointer events, so the closed sheet never sits on top of the canvas
 * even though its box covers the right-hand side of the screen.
 *
 * The builder stays mounted until the roll-up has finished, or the paper would go
 * blank the instant it started closing. A timer, not `transitionend`, because under
 * reduced motion there is no transition to end.
 */
export function PaperSheet({
  open,
  onOpen,
  children,
}: {
  open: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  const [tucked, setTucked] = useState(readTucked);

  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => setPresent(false), CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  const toggleTucked = () => {
    const next = !tucked;
    setTucked(next);
    writeTucked(next);
  };

  return (
    <div className="paper" data-open={open} data-tucked={tucked}>
      <div className="paper-sheet">
        <div className="paper-tab" inert={open}>
          <button
            className="paper-tuck"
            onClick={toggleTucked}
            aria-label={tucked ? 'Show the Make your own tab' : 'Hide the Make your own tab'}
            aria-pressed={tucked}
          >
            <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
              <path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="builder-open" onClick={onOpen}>
            Make your own
          </button>
        </div>
        {present ? (
          <div className="paper-body" inert={!open}>
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
