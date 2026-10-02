/**
 * Single source of truth for the vending-machine geometry.
 *
 * Modelled at 1 unit = 1 meter, anchored to real measurements:
 *   - 3-column card-vendor cabinet ~14"W x 17"H x 9"D (a DEEP box, not a frame)
 *   - Beaver-style chrome coin handle ~2.5"W x 3.25"H x 3.5"D
 *   - Pole + domed disc base proportions from reference-images/compressed/ref-00.
 *
 * Z+ points toward the camera; the cabinet face is at high Z, the body recedes
 * to negative Z.
 */
import type { SlotId } from '../data/celebration';
import { asset } from './assets';

const INCH = 0.0254;

/**
 * Outer red cabinet shell. A DEEP box (~2/3 of the width) standing on the pole;
 * only the FRONT carries the thin frame + proud glass pane. `faceZ` is the front
 * plane of the body (where the white face sits); `backZ` centres the deep body so
 * its front lands at `faceZ`.
 */
export const cabinet = {
  width: 14 * INCH, // ~0.356
  height: 17 * INCH, // ~0.432
  depth: 9 * INCH, // ~0.229
  centerY: 0,
  /** Front plane of the red body shell (and the red frame rim). */
  faceZ: 0.012,
  /** Shared corner radius for the WHOLE shell (body + front rim are one piece). */
  cornerRadius: 0.012,
} as const;

// The body is one continuous shell whose front face is at cabinet.faceZ.
const cabinetBodyFrontZ = cabinet.faceZ;
const cabinetBackZ = cabinetBodyFrontZ - cabinet.depth;

/**
 * The red front is the body's OWN front face: a continuous rim around a recessed
 * white opening (NOT separate rail boxes). `frameWidth` is the red border around
 * the opening; the white panels sit recessed by `openingDepth`.
 */
export const frame = {
  /** Width of the red rim around the recessed white opening. */
  frameWidth: 0.018,
  /** How far the white opening is recessed behind the red front face. */
  openingDepth: 0.01,
  color: '#d8312c',
  colorDark: '#b8241f',
  /**
   * Four corner caps that sit PROUD of the front rim (angled red brackets). Part
   * of the same red look; they stand a little above the front face.
   */
  cornerCap: {
    width: 0.034,
    height: 0.03,
    depth: 0.012,
    /** Hug the OUTER rim corners (2mm inset, no overhang). */
    x: cabinet.width / 2 - 0.034 / 2 - 0.002, // 0.1588
    y: cabinet.height / 2 - 0.03 / 2 - 0.002, // 0.1989
    /** Cap FRONT plane: proud enough to sit IN FRONT of the chrome glass frame
        so the frame corners tuck cleanly under the caps (ref-02). */
    frontZ: cabinet.faceZ + 0.01, // 0.022
    /** Right-angle brackets — NO tilt (ref-02 corners are square). */
    topTilt: 0,
    bottomTilt: 0,
  },
  /** Brass latch knob centred on the top rim. */
  latch: {
    radius: 0.007,
    height: 0.014,
    color: '#c19a3a',
  },
} as const;

const innerWidth = cabinet.width - 2 * frame.frameWidth; // ~0.32
const innerHeight = cabinet.height - 2 * frame.frameWidth; // ~0.396
const upperFraction = 0.72;
const upperHeight = innerHeight * upperFraction; // ~0.285
const lowerHeight = innerHeight * (1 - upperFraction); // ~0.111
const panelSeamY = innerHeight / 2 - upperHeight; // ~ -0.087

/**
 * White opening face. Its front sits ~flush with the red front rim so the white
 * shows, framed by the red border (the body's own front) around it. A shallow
 * recess (openingDepth) gives the border a little relief without hiding the white.
 */
export const face = {
  width: innerWidth,
  height: innerHeight,
  /** Front plane of the white panel: flush with the red front face. */
  z: cabinet.faceZ + 0.0006,
  color: '#f6f4ee',
} as const;

export const upperPanel = {
  width: innerWidth,
  height: upperHeight,
  centerY: panelSeamY + upperHeight / 2, // ~ +0.056
} as const;

export const lowerPanel = {
  width: innerWidth,
  height: lowerHeight,
  centerY: panelSeamY - lowerHeight / 2, // ~ -0.143
} as const;

/**
 * The display pane is ONE composable unit: a chrome-framed glass rectangle whose
 * centre is the single anchor (`glass.centerY`). EVERYTHING inside — title,
 * subtitle, grid, footer — is positioned as an OFFSET from that centre / a
 * fraction of `glass.height`. So moving the whole display block down/up (to use
 * the space above the coin holders) is a ONE-LINE change to `glass.centerY`; the
 * contents follow automatically.
 *
 * The glass sits IN FRONT of the title/grid/footer (a real display window): the
 * pane's BACK face is just proud of the content so you look THROUGH the glass at
 * the prints. Uses MeshTransmissionMaterial so the content behind reads correctly
 * (a plain transparent pane z-sorts troika text wrong at oblique angles).
 */
const GLASS_HALF = 0.135; // half the pane height (height 0.27)

export const glass = {
  // Slightly narrower than the inner face so the chrome frame clears the (now
  // smaller) corner caps while still using the space well.
  width: innerWidth - 0.018, // 0.3016
  height: GLASS_HALF * 2, // 0.27
  depth: 0.004,
  // Anchor: dropped to fill the empty band above the coin holders (was 0.0535).
  // Bottom edge (~ -0.107) clears the handle tops (~ -0.127).
  centerY: 0.028,
  /** Front plane of the glass: proud of the red front face. The pane spans
      [z - depth, z]; its BACK face (z - depth = 0.016) sits just in front of the
      content plane (faceLayout.z = 0.0145), so the glass covers the prints. */
  z: cabinet.faceZ + 0.008, // 0.020
  color: '#eafcff',
  /** Thin chrome rails framing the glass edge (upper area only). */
  chromeFrame: {
    thickness: 0.009,
    depth: 0.012,
    color: '#d6d4cd',
  },
} as const;

/**
 * Layout of the print thumbnails + text WITHIN the glass pane. Every Y is
 * `glass.centerY + (fraction of GLASS_HALF)` so the block moves as one with the
 * pane. Content Z sits just BEHIND the glass back face so the glass covers it.
 */
export const faceLayout = {
  // Behind the glass back face (0.016) but in front of the white panel (0.0126),
  // so the title/grid/footer sit UNDER the glass like a real display window.
  z: cabinet.faceZ + 0.0025, // 0.0145
  titleY: glass.centerY + GLASS_HALF * 0.82,
  subtitleY: glass.centerY + GLASS_HALF * 0.58,
  footerY: glass.centerY - GLASS_HALF * 0.84,
  textColor: '#1c2228',
  /**
   * FIXED inputs to the data-driven grid (`gridLayout` does the rest). The grid is now
   * PAGINATED: a fixed column count (matching the three coin handles) AND a fixed row
   * count per page, so the thumbnail size stays CONSTANT and readable no matter how
   * large the catalogue grows. The catalogue is split into pages of `cols * rowsPerPage`
   * prints; the face shows one page at a time with `<`/`>` arrows + page dots.
   */
  grid: {
    /** Columns = the three coin handles (print i lives in column i % cols). Fixed
        hardware: keep in sync with `slotOrder` (3) in celebration.ts. */
    cols: 3,
    /** Rows PER PAGE. cols * rowsPerPage = prints per page (3 * 2 = 6) — matches the
        original 6-print face at a comfortable fixed size. */
    rowsPerPage: 2,
    gapX: 0.014,
    gapY: 0.016,
    /** Vertical center of the whole grid block (centred in the band below the subtitle). */
    centerY: glass.centerY - GLASS_HALF * 0.04,
    /** Inner margins carved out of the glass for the grid's bounding box. */
    sideMargin: 0.006,
    topPad: 0.012, // below the subtitle
    bottomPad: 0.016, // above the footer
    /** Thumbnail = this fraction of the (square) cell; label rides below the thumb. */
    thumbFraction: 0.92,
  },
} as const;

/** Prints shown on one page of the face grid (3 cols x 2 rows). The catalogue is
 *  split into pages of this size. Single source of truth for the page size, consumed
 *  by the layout helpers below + the MachineFace pager. */
export const PAGE_SIZE = faceLayout.grid.cols * faceLayout.grid.rowsPerPage;

/** How many pages `count` prints split into (>= 1). */
export function pageCount(count: number): number {
  return Math.max(1, Math.ceil(Math.max(0, count) / PAGE_SIZE));
}

/** Which 0-based page a catalogue `index` lands on. */
export function pageOfIndex(index: number): number {
  return Math.floor(index / PAGE_SIZE);
}

/** A catalogue `index`'s 0..PAGE_SIZE-1 slot WITHIN its page (the cell it occupies on
 *  the visible grid). */
export function thumbSlotOnPage(index: number): number {
  return index % PAGE_SIZE;
}

/** Result of laying out ONE PAGE of the glass grid (a fixed 3 x rowsPerPage block). */
export type GridLayout = {
  cols: number;
  rows: number;
  /** Square cell size (the larger of thumb+label fits within this). */
  cell: number;
  /** Thumbnail edge length (cell * thumbFraction). */
  thumb: number;
  colSpan: number;
  rowSpan: number;
  /** Label Y offset from a cell centre (scaled to the cell). */
  labelOffsetY: number;
  /** Full grid bounding width (cols cells + gaps) — e.g. for the footer text width. */
  width: number;
};

/**
 * Lay out one PAGE of the print grid: a FIXED 3-column x `rowsPerPage`-row block sized
 * to fit the glass pane. Because the row count is now fixed (not `ceil(count/cols)`),
 * the cell/thumbnail size is CONSTANT for any catalogue length — the catalogue grows by
 * adding PAGES, not by shrinking thumbnails. Single source of truth for grid sizing —
 * consumed by the MachineFace grid AND by `thumbWorldPosition` (the card's
 * return-to-thumbnail target). Takes no arguments now: every page is the same size.
 */
export function gridLayout(): GridLayout {
  const { grid } = faceLayout;
  const cols = grid.cols;
  const rows = grid.rowsPerPage;
  const availableWidth = glass.width - 2 * grid.sideMargin;
  const bandTop = faceLayout.subtitleY - grid.topPad;
  const bandBottom = faceLayout.footerY + grid.bottomPad;
  const availableHeight = bandTop - bandBottom;
  const cellByWidth = (availableWidth - (cols - 1) * grid.gapX) / cols;
  const cellByHeight = (availableHeight - (rows - 1) * grid.gapY) / rows;
  const cell = Math.min(cellByWidth, cellByHeight);
  const thumb = cell * grid.thumbFraction;
  return {
    cols,
    rows,
    cell,
    thumb,
    colSpan: cell + grid.gapX,
    rowSpan: cell + grid.gapY,
    labelOffsetY: -cell * 0.58,
    width: cols * cell + (cols - 1) * grid.gapX,
  };
}

/**
 * WORLD position of the face-grid cell at `slotOnPage` (0..PAGE_SIZE-1) on the visible
 * page. The single source of truth for where each print "lives" on the face — consumed
 * BOTH by the MachineFace grid AND by the card's close animation (the taken card flies
 * back to its own thumbnail and disappears). Because every page uses the same fixed grid,
 * a print's home is its slot on its page; this is always ON-pane and stable regardless of
 * how many prints exist or which page is showing. The machine sits at the world origin in
 * X/Y, so cabinet-frame == world for those axes; Z is the face content plane.
 */
export function thumbWorldPosition(slotOnPage: number): [number, number, number] {
  const layout = gridLayout();
  const row = Math.floor(slotOnPage / layout.cols);
  const col = slotOnPage % layout.cols;
  // Full fixed grid: every page row is a complete `cols`-wide row, centred on X=0.
  const rowStartX = -((layout.cols - 1) / 2) * layout.colSpan;
  const startY = ((layout.rows - 1) / 2) * layout.rowSpan;
  return [
    rowStartX + col * layout.colSpan,
    faceLayout.grid.centerY + (startY - row * layout.rowSpan),
    faceLayout.z,
  ];
}

/** Three coin handles in a row across the lower band. */
const handlePitch = 0.104;
export const slotX: Record<SlotId, number> = {
  left: -handlePitch,
  middle: 0,
  right: handlePitch,
};

/** Y centre of the handle row in the lower band. */
const handleCenterY = lowerPanel.centerY;

/**
 * The chrome coin HANDLE mechanism (ref-01/03/04). TWO chrome pieces:
 *
 *   - OUTER (static U-shell): wraps the inner on the BOTTOM, LEFT and RIGHT
 *     (floor + two low side walls); TOP and FRONT are open. On the floor's
 *     upper face are 4 RAILS running front-to-back; the inner rides on them.
 *   - INNER (slides in/out along Z on the rails): a trapezoid pull, lower/wider
 *     at the front. Its TOP face has 5 vertical coin slots (drop quarters in from
 *     above: left 4 open + 4 coins when coined; 5th/rightmost is filled/blind).
 *     A "$1.00" plate sits on the front lip.
 *
 * The card emerges from the slit between the white face and the chrome top; the
 * card is owned by FoldedCardPart, not the Handle.
 *
 * Local frame: +Z toward the viewer (front), +Y up, +X right. Origin at the
 * mechanism centre; the handle protrudes in +Z from the lower band.
 */
/**
 * The chrome coin HANDLE mechanism, modelled on a real ESD Standard V-5 (the
 * photos in reference: a square chrome bezel bolted to the white face, a long
 * thin hammered-metal tongue sliding under it, a small trapezoid grip at the
 * user end). THREE real objects:
 *
 *   1. FRAME (`frame`, STATIC): a flat square chrome plate bolted to the face. A
 *      black foam gasket strip runs across its TOP edge; two screws at the top
 *      corners + one tiny center screw. The FIVE COIN SLOTS are cut into the
 *      frame's upper area (NOT the tongue): the user drops quarters into the
 *      fixed frame, so the slots never move. The tongue's flat top passes UNDER
 *      this slot row. Left 4 slots open (take coins), 5th (blindIndex) sealed.
 *   2. RAIL HOUSING (`outer`, STATIC): floor + two low side cheeks + front-to-back
 *      rails the tongue rides on.
 *   3. TONGUE (`inner`, SLIDES in/out on Z): a LONG, THIN, hammered-texture pull
 *      with a FLAT top (no slots — those moved to the frame) carrying a recessed
 *      logo panel, stepping DOWN at the user end to the trapezoid grip that
 *      carries the "$1.00" plate.
 *
 * The card emerges from the slit between the white face and the frame (owned by
 * FoldedCardPart / CabinetBody, not the Handle).
 *
 * Local frame: +Z toward the viewer (front), +Y up, +X right. Origin at the
 * mechanism centre; the tongue protrudes in +Z from the lower band.
 */
export const handle = {
  centerY: handleCenterY,
  /** Overall footprint of one mechanism (used for the cavity + hit area). A
      SHALLOW, LONG chrome scoop: wide + deep front-to-back, low in height. */
  width: 0.084,
  height: 0.032,
  depth: 0.092,

  /**
   * STATIC frame bezel bolted to the white face, carrying the coin slots + foam
   * gasket + screws. A flat chrome plate standing just PROUD of the face (so it
   * reads as bolted on). Drawer-local: the face front is at z ≈ -0.029 and the
   * card slit at z ≈ -0.031 / Y +0.03; the bezel's slot row sits in its UPPER
   * area and the bezel TOP stays below the slit so the card opening is clear.
   */
  frame: {
    /** Plate WIDER than the rail housing so it overlaps the rails (the real
        bezel covers the housing mouth). */
    width: 0.07,
    height: 0.054,
    /** Plate DEEP enough that its back reaches the white face (front at -0.022,
        back at -0.022 - 0.008 = -0.030 ≈ the face plane), so it reads as bolted
        flush to the machine, not floating in front of it. */
    thickness: 0.008,
    /** Front face of the plate, drawer-local Z (proud of the face ≈ -0.029). */
    frontZ: -0.022,
    color: '#d6d4cd',
    /** Y of the plate centre RELATIVE to the mechanism origin. Set LOW so the
        slot row (centre + coinSlots.rowOffsetY) lands at the slab/tongue level
        where the cutouts register; the plate still rises UP to the foam strip
        above. */
    centerY: -0.004,
    /** Black foam gasket strip across the TOP edge of the bezel. */
    foam: {
      height: 0.006,
      /** Proud of the plate front by this much. */
      proud: 0.0012,
      color: '#15161a',
    },
    /** Chrome screws: two at the top corners + one tiny center fastener. */
    screw: {
      radius: 0.0018,
      length: 0.0022,
      /** Inset of the corner screws from the bezel top + side edges. */
      inset: 0.006,
      color: '#c8c6bf',
    },
  },

  /** Static outer U-shell + the floor rails the tongue slides on. */
  outer: {
    /** Inside clear width the tongue slides within (snug to the thin tongue). */
    innerClearWidth: 0.05,
    /** Floor plate. */
    floorThickness: 0.005,
    floorDepth: 0.088,
    /** Low side cheeks (left + right) — barely proud of the tongue. */
    wallThickness: 0.006,
    wallHeight: 0.012,
    wallDepth: 0.088,
    /** Front-to-back rails on the floor's upper face (visible chrome strips
        flanking + under the tongue). */
    rail: {
      count: 4,
      width: 0.004,
      height: 0.003,
      depth: 0.08,
      pitch: 0.012,
    },
    color: '#dad8d1',
  },

  /**
   * The TONGUE (sliding pull): a LONG, THIN, FLAT slab of hammered metal at ONE
   * constant height (the ESD-logo face is all one plane). Its BACK edge (toward
   * the frame) has FIVE slots cut into it that REGISTER with the frame's coin
   * slots — a coin dropped through a frame slot lands in the matching slab
   * cutout, and pushing the slab carries the coin in. At the user (+Z) end a
   * small UPTURNED PULL TAB stands proud of the slab — the finger flange that
   * carries the "$1.00" plate on its front face.
   */
  inner: {
    width: 0.048, // extrude depth = part width (snug in the rails)
    length: 0.08, // total front-to-back span (matches the rail depth)
    /** Flat slab thickness (a low, flat tongue — but with some heft). */
    thickness: 0.009,
    /** Vertical lift so the tongue sits on top of the rails. */
    liftY: 0.0,
    color: '#dedcd5',
    /** Slots cut into the slab's BACK edge, aligned to the frame's coin slots
        (same count/pitch/X via coinSlots). They run front→back from the back edge
        forward by `length`; a coin drops through the frame slot into the matching
        cutout. The 5th (coinSlots.blindIndex) is NOT cut (sealed, like the frame).
        `inset` = how far the cut row sits forward of the very back edge. */
    backCutouts: {
      length: 0.026, // how far forward each cutout runs from the back edge
      inset: 0.001,
    },
    /** Recessed logo panel on the slab top (plain — no text). Inset from the
        slab edges; a shallow darker recess that reads as the embossed panel.
        Sits on the FRONT half of the slab (clear of the back cutouts). */
    logoPanel: {
      width: 0.026,
      length: 0.022,
      recessDepth: 0.0008,
      color: '#c2c0b9',
    },
    /** Small upturned pull tab at the user (+Z) end: a TRAPEZOID flange (tapered
        like the $1.00 plate — narrower at the top) standing proud of the slab
        that the fingers hook; the $1.00 plate sits on its front (+Z) face. */
    pullTab: {
      width: 0.04, // bottom edge width
      /** Top edge width as a fraction of the bottom (trapezoid taper, matches the
          $1.00 plate's topScale). */
      topScale: 0.82,
      /** How far it stands ABOVE the slab top. */
      height: 0.012,
      thickness: 0.0025,
    },
  },

  /** How far FORWARD (from the face plane) the whole mechanism is mounted, so the
      handle protrudes from the lower band and is fully visible (not half-buried).
      Applied to the whole Handle group in the assembled scene. */
  mountZ: 0.03,

  /** Slide targets (tongue's local Z offset) by status. */
  zOut: 0.0, // neutral, pulled out (rest)
  zIn: -0.05, // pushed in

  /** Five coin slots running front→back, cut into the STATIC frame's upper area;
      left 4 open, index 4 sealed/blind. Long thin slits side by side across the
      width. Placed by the frame, NOT the tongue. */
  coinSlots: {
    count: 5,
    blindIndex: 4,
    width: 0.0035,
    length: 0.016, // front→back length of each slit (short — upper third of bezel)
    /** Slit box depth: pokes a hair proud of the bezel face so the dark slit is
        visible and never coplanar with the chrome plate. */
    depth: 0.003,
    pitch: 0.009,
    /** Y of the slot-row centre RELATIVE to the frame centre. Tuned so the slot
        row lands at the SLAB TOP (≈ local Y 0.005), where the tongue's back
        cutouts register — a coin dropped through a frame slot lands in the
        matching tongue cutout. The bezel rises ABOVE the slots to the foam strip. */
    rowOffsetY: 0.009,
    openColor: '#08090b',
    filledColor: '#cdcbc4',
  },

  /** Quarters sitting in the left 4 slots when coined (drop in from above into
      the fixed frame, sit down IN the slot so only the top arc shows). */
  coin: {
    radius: 0.0072,
    thickness: 0.0015,
    color: '#cdb45f',
  },

  /** Blue-bordered trapezoid $1.00 plate on the front (+Z) face of the upturned
      pull tab (tapers: narrower at the top). */
  label: {
    width: 0.03,
    height: 0.011,
    /** Top edge width as a fraction of the bottom (trapezoid taper). */
    topScale: 0.82,
    borderColor: '#1c47a0',
    faceColor: '#fbfaf4',
    textColor: '#10233f',
  },

  /** Worn-chrome material props shared across the mechanism. */
  chrome: {
    color: '#dcdad3',
    roughness: 0.16,
    metalness: 1,
  },
} as const;

/** Dark recessed cavity each handle sits in (a real opening in the lower band).
 *  Centred just behind the white face so it reads as a dark bay around the
 *  handle without poking through the body front. */
export const handleCavity = {
  width: handle.width + 0.006,
  height: handle.height + 0.012,
  depth: 0.024,
  y: handle.centerY,
  z: cabinet.faceZ - 0.016,
} as const;

/**
 * ONE stiff print card (ref-04/06): a single rectangle of white stock. FRONT
 * face = the artwork + handwritten title + "A1" corner; BACK face = the personal
 * message. Default PORTRAIT; landscape prints just swap width/height (see
 * `printSize` in FoldedCardPart, which reads `aspect` from the print data).
 */
export const print = {
  /** White print stock (portrait default). */
  width: 0.072,
  height: 0.096,
  /** Stiff card stock thickness. */
  thickness: 0.0016,
  /** The illustration printed on the stock, inset with a paper border. */
  artWidth: 0.072 * 0.9, // ~0.065
  artHeight: 0.096 * 0.82, // ~0.079
  /** Shift the art up so the handwritten title clears the bottom margin. */
  artOffsetY: 0.006,
} as const;

/**
 * The card is a KRAFT FOLDING JACKET (folds in half along a horizontal spine)
 * that holds a separate PRINT INSERT inside. It pops out FOLDED (lying flat
 * forward), and OPENING unfolds the jacket to reveal the print; the print insert
 * then flips (front art / back message). White outside, kraft inside.
 */
export const card = {
  /** One panel of the folded jacket (a bit larger than the print insert). */
  panelWidth: print.width + 0.012, // ~0.084
  panelHeight: print.height + 0.011, // ~0.107
  thickness: 0.0024,
  spineHeight: 0.004,
  boardColor: '#c9b389',
  whiteColor: '#f1ede3',
  /** OPEN lid angle (hinge.rotation.x while open). closed = -PI (lid folded onto the
      base FRONT, +z, covering the print). The END POSE we want is the lid standing up
      and tipped a LITTLE toward the camera (a propped open book), print fully clear.
      That orientation is +0.16π — BUT reaching it by INCREASING from -PI sweeps the lid
      the LONG way THROUGH THE BACK (it dips to -PI/2 pointing away from the eye first,
      reading as "opens backward / rotates the wrong way"). The IDENTICAL orientation is
      reached the CORRECT way by DECREASING from -PI to -2PI+0.16π = -1.84π: the lid's
      free edge rises up and FORWARD (+z, toward the camera) the whole sweep, never
      passing behind. Same final look, right-handed (clockwise from the right). */
  openHingeAngle: -Math.PI * 2 + Math.PI * 0.16, // ≡ +0.16π pose, reached via the forward sweep
  /** Z offset of the lid hinge from the base. Tall enough that, when the lid folds
      cover-to-cover (rotation.x = -PI), its kraft inner face JUST clears the PRINT
      INSERT protruding from the base (so the print never z-fights through the white
      fold) — but no taller, or a visible air-gap opens at the folded seam and the
      print peeks out the side. Print front sits ~0.0041 above the base centre; the
      lid inner lands at ~lidHingeZ - thickness/2, so lidHingeZ ≈ printFront +
      thickness/2 + a hair. */
  lidHingeZ: 0.0041 + 0.0012 + 0.0003, // ~0.0056

  // Motion (Drawer-local frame; origin at handle centre, +Z toward viewer).
  /** Stowed: tucked low + behind the face, hidden. */
  stowedY: -0.02,
  stowedZ: -0.05,
  /** Dispensed: lies FLAT and DEAD LEVEL at slit height, slid out only ~25% through
      the slit (most still inside, white — print hidden). The packet is BORN flat and
      only translates +Z out the slit (no rotation while sliding); it starts at
      `hiddenZ` (behind the face) and is pushed out to `dispensedZ` coupled to the
      handle pull. */
  dispensedY: handle.height / 2 + 0.014, // ≈ slitLocalY (level, supported)
  /** Drawer-local Z of the card slit in the face (where the packet emerges). The
      slit mesh is at world `face.z - 0.002`; the drawer origin is at world
      `cabinet.faceZ + handle.mountZ`, so the slit in drawer-local Z is the
      difference. */
  slitLocalZ: (cabinet.faceZ + 0.0006 - 0.002) - (cabinet.faceZ + handle.mountZ), // ≈ -0.0314
  /** When laid flat (flatQuat = -90° about X), the jacket's root origin sits at the
      BACK (spine) edge and the panels extend FORWARD (+Z) by ~panelHeight+spine. So
      the packet's FRONT edge = root.z + packetLength. */
  // (packetLength ≈ panelHeight + spineHeight ≈ 0.111; defined inline below.)
  /** Dispensed REST: ~25% of the packet pokes past the slit. root.z = slitZ +
      0.25*len - len = slitZ - 0.75*len. */
  dispensedZ: ((cabinet.faceZ + 0.0006 - 0.002) - (cabinet.faceZ + handle.mountZ)) - 0.75 * ((print.height + 0.011) + 0.004), // ≈ -0.114
  /** Starting Z while FULLY inside the machine: front edge AT the slit, whole packet
      (a full kraft-length) behind the face. root.z = slitZ - len. */
  hiddenZ: ((cabinet.faceZ + 0.0006 - 0.002) - (cabinet.faceZ + handle.mountZ)) - 1.0 * ((print.height + 0.011) + 0.004), // ≈ -0.142
  /** Fraction of the slide-out budget the packet WAITS (hidden inside) before it
      begins to emerge — so it pops out in the last ~45% of the handle's pull,
      reading as "the handle pushes the print out the slit". */
  emergeGate: 0.55,
  /** No tilt: the dispensed packet is dead level (ref-01). */
  dispensedTilt: 0,
  /** Slit Y in the drawer-local frame (cabinet-frame y = handle.centerY + this). */
  slitLocalY: 0.03,

  // ---- Open sequence (ordered phases; see FoldedCardPart) ----
  /** Phase (a): slide the folded packet FULLY clear of the slit on one axis (+Z)
      before it ever moves toward the camera, so it never passes through the handle. */
  slideOutZ: 0.1,
  /** Open-card viewing distance in front of the camera (closer than the global
      VIEWER_DISTANCE so the unfolded card fills more of the frame). */
  viewerDistance: 0.36,
  /** Flip: forward +Z lift on the print insert BEFORE it spins, so the rotating
      insert clears the kraft jacket instead of clipping through it. When the insert
      spins 180° about Y, a corner dips toward the kraft by ~printW/2 (≈0.036). The
      lift must EXCEED that sweep radius (plus a margin) or the back corner ploughs
      through the panel mid-turn. */
  flipForwardZ: 0.044,
  /** Seconds for one full insert flip (lift → spin → settle). Progress-driven, so the
      reverse turn animates identically to the forward one. */
  flipDuration: 0.9,
  /** LANDSCAPE prints dispense exactly like portrait (vertical packet from the
      slit); only ONCE OPEN at the camera does the WHOLE jacket ROLL 90° in the
      screen plane (about the view axis, the card's local +Z that points at the eye)
      so it reads horizontally with the cover opening to the LEFT — while the print
      still faces the viewer. (A yaw about local Y would turn the card edge-on; this
      is a ROLL.) Composed onto the face-camera quaternion for landscape only. */
  landscapeOpenRoll: Math.PI / 2,

  /** Back-face MESSAGE scroll. When a print's message is taller than the print
      rectangle, it clips to the print and scrolls (wheel/drag while open + flipped). */
  message: {
    /** Inset (m) inside the print rect on each side, so text doesn't touch the edges. */
    inset: 0.006,
    /** World metres scrolled per unit of wheel deltaY (deltaY is ~100/notch). */
    wheelSpeed: 0.00006,
    /** Drag: world metres scrolled per world metre the pointer moves (1:1 feel). */
    dragSpeed: 1,
    /** Smooth-damp lambda easing the visible offset toward the target (snappy). */
    damp: 12,
    /** Scroll-affordance chevron size (m) shown top/bottom-right when overflowing. */
    chevronSize: 0.006,
  },

  /** Per-phase smooth-damp lambdas (frame-rate independent; larger = snappier). */
  dampSlide: 7, // one-axis slit slide-out (crisp)
  dampFly: 5, // travel to the camera (smooth/floaty)
  dampUnfold: 6, // hinge open
  dampClose: 6, // retreat behind the face
  /** Phase durations (seconds): max hold before the epsilon early-escape advances.
      EXCEPTION: durSlideout is now the REAL fixed duration of the take-the-card slide
      (no early-escape) — deliberately ≈ the card-take SFX's slide-to-clack span (~0.47s,
      measured) so the packet finishes sliding out the slit exactly as the metallic clack
      rings, then flies to the viewer. Keep this in sync with the card-take clip length. */
  durSlideout: 0.47,
  durFly: 0.7,
  durUnfold: 0.55,
  durClose: 0.6,
  /** Convergence epsilons for early phase advance. */
  epsPos: 0.002, // 2mm
  epsAngle: 0.03,
} as const;

/** Horizontal card-emerge slit in the face above each handle. */
/**
 * The "make your own" tent card standing on top of the cabinet, right of the brass
 * latch. It is how a visitor gets to the builder, and it lives IN the set (a shop
 * sign in the cream of the machine's own face) so nothing floats over the scene. It
 * is cream rather than kraft because kraft vanished against the tan books behind. The
 * front panel leans back by `lean` and a second panel props it from behind, hinged
 * at the top edge, so it still reads as a folded card when the camera orbits.
 */
export const sign = {
  width: 0.168,
  height: 0.058,
  thickness: 0.0016,
  color: '#f6f1e6',
  /** How far each panel tips from vertical (rad). */
  lean: 0.2,
  /** Sits on the cabinet's top face, right of the latch, a little back from the rim. */
  x: 0.082,
  y: cabinet.height / 2,
  z: cabinet.faceZ - 0.014,
  /** A few degrees off square, so it looks set down by hand. */
  yaw: -0.07,
  inkColor: '#2a2420',
  titleSize: 0.014,
  noteSize: 0.0112,
  /** The red "+" sticker at the left of the lettering. */
  badgeRadius: 0.0115,
  /** How much the card grows under the pointer. */
  hoverScale: 1.06,
} as const;

export const cardSlit = {
  width: print.width + 0.016,
  height: 0.005,
  depth: 0.012,
  color: '#0a0b0d',
} as const;

/** Black pedestal pole + wide trumpet/domed disc base (owned by CabinetBody). */
export const pedestal = {
  poleRadius: 0.03,
  poleHeight: 0.82,
  color: '#101114',
  cabinetBottomY: cabinet.centerY - cabinet.height / 2,
  /**
   * Lathe profile (radius, y) for the swept TRUMPET/DOME base: rises toward the
   * pole and flares out in a smooth curve to a wide rim on the floor (ref-00). A
   * pronounced dome (taller than a flat disc). y is relative to the base origin
   * (top near the pole, descending to the floor rim).
   */
  baseProfile: [
    { radius: 0.0, y: 0.05 }, // crown of the dome (near the pole)
    { radius: 0.03, y: 0.048 },
    { radius: 0.06, y: 0.04 },
    { radius: 0.1, y: 0.026 },
    { radius: 0.14, y: 0.008 },
    { radius: 0.18, y: -0.014 },
    { radius: 0.21, y: -0.032 },
    { radius: 0.23, y: -0.044 }, // outer rim on the floor
    { radius: 0.232, y: -0.05 },
    { radius: 0.0, y: -0.05 }, // flat underside back to the centre
  ],
} as const;

/**
 * The floor the pedestal base stands on. Derived from the pedestal so the shadow
 * catcher, the contact shadow, and the grounded-env projection (the HDRI's own floor)
 * all share ONE Y — moving the floor is a one-line change here. The machine now sits
 * ON the room floor instead of floating on the HDRI sphere.
 */
export const floor = {
  /** World Y of the base underside: pedestal base origin + the profile's bottom rim
      (baseProfile bottoms out at local y = -0.05). ≈ -1.086. */
  y: pedestal.cabinetBottomY - pedestal.poleHeight - 0.05,
  /** Radius of the transparent shadow-catcher disc: comfortably wider than the base
      so the machine's grounding shadow always lands within it. The VISIBLE floor is
      the grounded-env HDRI projection, which extends past this disc. */
  radius: 0.6,
} as const;

/**
 * Cozy indie-bookstore diorama the machine sits in (single source of truth). A warm
 * honey-wood floor + a cream back wall + a wooden bookshelf of colorful book spines,
 * built as real geometry (NOT a photo HDRI) so the machine reads as standing in a
 * little bookshop corner. Everything is placed relative to `floor.y` (the floor) and
 * to negative Z (behind the machine, which faces +Z toward the camera).
 *
 * Sizes are generous in X/Y so the floor + wall FILL the frame at the default close
 * camera with no visible edges; the machine + shelf stay well inside them.
 */
export const bookstore = {
  /** Warm honey-wood floor plane at `floor.y`. Large enough that the machine's cast
      shadow lands on a continuous surface with no abrupt disc edge behind it. */
  floor: {
    size: 6, // square plane edge (m) — well past the frame
    color: '#b07a44', // honey/oak
    roughness: 0.72,
    metalness: 0,
  },
  /** Cream warm-white back wall, parallel to the camera, behind the machine + shelf.
      `z` is negative (recedes from the camera); `height` rises from the floor up. */
  wall: {
    z: -0.9,
    width: 6,
    height: 4,
    /** Wall centre Y: sits so its bottom meets the floor and it rises past frame top. */
    centerY: floor.y + 4 / 2,
    color: '#efe6d6',
    roughness: 0.95,
    metalness: 0,
  },
  /**
   * A WALL OF BOOKS: wall-mounted full-width shelf planks stacked up the wall, each
   * carrying a procedurally-arranged row of books (varied size/colour, mostly upright
   * with occasional leaners + horizontal stacks). The machine stands in front of it.
   * This reads as a real indie bookshop far better than a single cabinet.
   *
   * The shelves span `spanWidth` centred on X=0 — generous enough to cover the visible
   * wall plus wide-orbit margin, but NOT the full 6m wall (the far edges are never on
   * screen, so books there would be wasted geometry). All books across all rows render
   * in ONE instanced draw call, so the count (~hundreds) is cheap.
   */
  shelving: {
    /** Horizontal span of the shelf planks (centred on X=0). Covers the visible wall
        + orbit margin; ~the width that's ever framed at the clamped camera. */
    spanWidth: 4.5,
    /** Plank just in front of the wall (wall at `wall.z` = -0.9); books stand on top of
        it. Sized so the plank back + the books behind it stay IN FRONT of the wall (no
        poke-through) while the books stay well behind the machine face (z ≈ 0.02). */
    plankZ: -0.8,
    plankThickness: 0.022,
    plankDepth: 0.16,
    /** Wood a touch darker than the floor so shelves read against the cream wall. */
    woodColor: '#9c6a3c',
    woodRoughness: 0.62,
    /** Vertical rhythm: the first shelf sits this far above the floor, then every
        `rowPitch` up, until past the top of the visible wall. The row PITCH must
        exceed the tallest book so rows don't collide. */
    firstRowY: floor.y + 0.35,
    rowPitch: 0.34,
    /** Enough rows to fill the visible wall behind the machine at the clamped camera
        (≈7 are ever framed); more would be off-screen geometry. */
    rowCount: 7,
    /** Small mounting brackets bridging each plank back to the wall (so shelves read
        as mounted, not floating). A few per plank, evenly spaced. */
    bracket: {
      width: 0.04,
      height: 0.05,
      perPlank: 7,
      color: '#8a5d34',
    },
    /** Procedural books standing on each plank. */
    book: {
      /** Upright spine thickness (X) range. */
      minThickness: 0.018,
      maxThickness: 0.045,
      /** Upright spine height (Y) range (must stay under rowPitch minus the plank). */
      minHeight: 0.16,
      maxHeight: 0.26,
      /** Spine depth (Z, how far the book sticks out from the wall). */
      minDepth: 0.1,
      maxDepth: 0.14,
      gap: 0.004,
      roughness: 0.8,
      /** Chance (0..1) a given slot leans instead of standing straight. */
      leanChance: 0.12,
      /** Max lean angle (radians) for a leaning book. */
      maxLean: 0.22,
      /** Chance (0..1) a slot becomes a small HORIZONTAL stack of 2-3 books laid flat
          instead of upright spines. */
      stackChance: 0.1,
      stackMin: 2,
      stackMax: 3,
      /** Warm, slightly muted spine palette (reads cozy, not candy). */
      palette: [
        '#7d4a3b',
        '#3f5d52',
        '#b08d57',
        '#8a4f4f',
        '#52607a',
        '#caa86a',
        '#6b6f4a',
        '#a8623f',
        '#9c4f5a',
        '#4a6670',
      ],
    },
  },
} as const;

/** A single book mesh (one instance): an upright spine, a leaning spine, or one slab
 *  of a horizontal stack. Positions are WORLD coordinates (the wall-of-books is placed
 *  at the scene origin in X/Y; the backdrop group adds no offset). */
export type BookInstance = {
  position: [number, number, number];
  /** [thickness (X), height (Y), depth (Z)] of the box before rotation. */
  scale: [number, number, number];
  /** Z-rotation (radians): 0 = upright, small = leaning, ±PI/2 = laid flat (stack). */
  rotationZ: number;
  color: string;
};

/** One mounted shelf plank's world Y (top surface books stand on) + plank centre Y. */
export type ShelfPlank = {
  /** Centre Y of the plank board. */
  centerY: number;
  /** Top surface Y (books rest here). */
  topY: number;
};

/** Result of laying out the whole wall of books. */
export type BookWallLayout = {
  planks: ShelfPlank[];
  books: BookInstance[];
};

/**
 * Deterministic Mulberry32 PRNG factory. Seeded so the book wall looks identical across
 * reloads (no module-load Math.random / Date surprises). Returns a 0..1 generator.
 */
function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lay out the WALL OF BOOKS from the `bookstore.shelving` SoT: a stack of full-width
 * mounted shelf planks and, on each, a procedurally-packed row of books — mostly
 * upright spines (varied thickness/height/colour), with occasional leaning books and
 * occasional small horizontal stacks. All Ys/Xs are WORLD coordinates at the shelving's
 * Z plane. Single source of truth — consumed by BookstoreBackdrop's plank meshes AND its
 * book instancing. Deterministic given the fixed seed.
 */
export function bookWallLayout(): BookWallLayout {
  const { shelving } = bookstore;
  const { book } = shelving;
  const random = seededRandom(0xb00c5);
  const halfSpan = shelving.spanWidth / 2;
  // Books rest on the plank with their BACK near the plank's back edge (close to the
  // wall) and protrude FORWARD toward the camera (+Z). A book of depth d is centred at
  // bookBackZ + d/2.
  const bookBackZ = shelving.plankZ - shelving.plankDepth / 2 + 0.012;

  const planks: ShelfPlank[] = [];
  const books: BookInstance[] = [];

  for (let row = 0; row < shelving.rowCount; row += 1) {
    const centerY = shelving.firstRowY + row * shelving.rowPitch;
    const topY = centerY + shelving.plankThickness / 2;
    planks.push({ centerY, topY });

    // Pack books left-to-right across the span, sitting on this plank's top surface.
    let x = -halfSpan;
    while (x < halfSpan) {
      const roll = random();
      const color = book.palette[Math.floor(random() * book.palette.length)];

      if (roll < shelving.book.stackChance) {
        // A small HORIZONTAL stack: 2-3 books laid flat, each a wide slab.
        const count =
          shelving.book.stackMin +
          Math.floor(random() * (shelving.book.stackMax - shelving.book.stackMin + 1));
        // Laid-flat book: long dimension along X (its former height), short along Y
        // (its former thickness). Use the depth as the X length so flat books look like
        // closed books seen edge-on from the side.
        const flatLength = book.minHeight + random() * (book.maxHeight - book.minHeight);
        const flatThickness =
          book.minThickness + random() * (book.maxThickness - book.minThickness);
        const flatDepth = book.minDepth + random() * (book.maxDepth - book.minDepth);
        if (x + flatLength > halfSpan) break;
        for (let s = 0; s < count; s += 1) {
          const stackColor = book.palette[Math.floor(random() * book.palette.length)];
          books.push({
            position: [
              x + flatLength / 2,
              topY + flatThickness / 2 + s * (flatThickness + 0.001),
              bookBackZ + flatDepth / 2,
            ],
            // Laid flat: box is [length (X), thickness (Y), depth (Z)].
            scale: [flatLength, flatThickness, flatDepth],
            rotationZ: 0,
            color: stackColor,
          });
        }
        x += flatLength + shelving.book.gap * 2;
        continue;
      }

      // An upright spine (possibly leaning).
      const thickness =
        book.minThickness + random() * (book.maxThickness - book.minThickness);
      const height = book.minHeight + random() * (book.maxHeight - book.minHeight);
      const depth = book.minDepth + random() * (book.maxDepth - book.minDepth);
      if (x + thickness > halfSpan) break;
      const leans = random() < shelving.book.leanChance;
      const rotationZ = leans ? (random() - 0.5) * 2 * shelving.book.maxLean : 0;
      books.push({
        position: [x + thickness / 2, topY + height / 2, bookBackZ + depth / 2],
        scale: [thickness, height, depth],
        rotationZ,
        color,
      });
      x += thickness + shelving.book.gap;
    }
  }

  return { planks, books };
}

/** Re-export so consumers don't recompute the deep body's planes. */
export const cabinetGeometry = {
  frontZ: cabinetBodyFrontZ,
  backZ: cabinetBackZ,
  centerZ: cabinetBodyFrontZ - cabinet.depth / 2,
} as const;

/** Smooth-damp lambdas (frame-rate independent). */
export const DAMP_HANDLE = 9;
export const DAMP_CARD_MOVE = 6;
export const DAMP_CARD_FOLD = 7;

/** Where the card animates to when opened: in front of the camera. A touch
 *  farther so the unfolded card sits fully in frame with breathing room. */
export const VIEWER_DISTANCE = 0.42;

/**
 * Fonts for the drei <Text> (troika). The Inciardi machine uses bold hand-marker
 * all-caps signage + casual handwriting for print titles. We match the vibe:
 *   DISPLAY_FONT = Permanent Marker (title / "4 QUARTERS" / "$1.00")
 *   LABEL_FONT   = Patrick Hand (small print titles + messages)
 * Self-hosted .ttf in public/fonts — troika needs a direct .ttf/.woff URL and
 * does NOT support .woff2.
 */
export const DISPLAY_FONT = asset('/fonts/PermanentMarker-Regular.ttf');
export const LABEL_FONT = asset('/fonts/PatrickHand-Regular.ttf');
