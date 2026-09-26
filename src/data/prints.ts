/**
 * THE PRINT CATALOGUE — the one file you edit to add/change prints.
 *
 * To add a print:
 *   1. Drop the image into ./prints/  (jpg, jpeg, png, webp, or svg).
 *   2. Add ONE entry below with its filename. title / message / orientation are
 *      all OPTIONAL.
 *
 * That is the whole workflow — no imports to add, no ids to invent, no types to
 * touch. `celebration.ts` resolves each `file` to its bundled image, derives a
 * stable id from the filename, and auto-detects portrait vs landscape from the
 * image's pixels (set `orientation` only to override a wrong guess).
 *
 * Prints CYCLE across the three coin handles by row: entry i is vended by handle
 * i % 3 and sits in column i % 3, row floor(i / 3) of the face grid. So order
 * here = order on the machine; the list can be any length.
 *
 * `message` is the writing on the BACK of the card (revealed when it flips).
 *
 * The prints shipped here are a sample birthday deck, drawn as flat SVG so the
 * machine has something to vend on a fresh clone. Replace them with your own —
 * that is the point of the toy.
 */
export type PrintEntry = {
  /** Filename inside ./prints/, e.g. 'birthday-sarah.jpg'. Matched case-insensitively. */
  file: string;
  /** Card title (shown at the bottom of the print). Omit for no title. */
  title?: string;
  /** Message on the BACK of the card, revealed when it flips. Omit for no message. */
  message?: string;
  /**
   * Override the auto-detected orientation. Normally leave this out: orientation is
   * read from the image (wider-than-tall = 'landscape', else 'portrait'). Set it only
   * if a particular image should be forced the other way.
   */
  orientation?: "portrait" | "landscape";
};

export const prints: PrintEntry[] = [
  { file: "ferris-wheel.svg", title: "Coney Island", message: "You screamed the whole way up and then made us go again." },
  { file: "cake.svg", title: "Happy birthday, Sam", message: "Four quarters, one wish. Make it a good one.\n\nLove, J" },
  { file: "cassette.svg", title: "The mixtape", message: "Still have it. Still can't rewind it without a pencil." },
  { file: "lighthouse.svg", title: "Lost in Maine", message: "Six hours lost, zero regrets. Best wrong turn we ever took." },
  { file: "teapot.svg", title: "2am tea", message: "For every night you stayed up talking me through it." },
  { file: "mountain.svg", title: "Next year", message: "The summit. You promised. I'm holding you to it." },
];
