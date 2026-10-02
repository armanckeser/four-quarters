import { useEffect, useState, type ReactNode } from 'react';

/** How long the sheet takes to roll back up. Mirrors `--paper-close` in builder.css. */
const CLOSE_MS = 260;

/**
 * The one sheet of paper over the scene.
 *
 * Closed, it is clipped down to a tag taped at the top right: "Make your own".
 * Pressed, the clip opens and the SAME sheet unrolls down into the builder, so the
 * tag is not a button that summons a panel, it is the corner of the panel. Closing
 * rolls it back up into the tag.
 *
 * The motion is one `clip-path` transition (builder.css), which buys two things: it
 * retargets from wherever it is if someone presses again mid-roll, and a clipped
 * region takes no pointer events, so the closed sheet never sits on top of the
 * canvas even though its box covers the right-hand side of the screen.
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

  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => setPresent(false), CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <div className="paper" data-open={open}>
      <span className="paper-tape" aria-hidden="true" />
      <div className="paper-sheet">
        <button className="builder-open" onClick={onOpen} tabIndex={open ? -1 : 0} aria-hidden={open}>
          Make your own
        </button>
        {present ? (
          <div className="paper-body" inert={!open}>
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
