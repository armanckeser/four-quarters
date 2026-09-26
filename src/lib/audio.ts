import { useEffect } from 'react';
import { asset } from './assets';

/**
 * One-shot UI sound effects for the machine's interactions. These are NOT spatial
 * emitters, so they live entirely outside the R3F scene graph (no drei
 * <PositionalAudio>, no AudioListener on the camera): a single shared Web Audio
 * context with a buffer pool. Each clip is fetched and decoded once into a reusable
 * AudioBuffer; every play creates a fresh AudioBufferSourceNode, so rapid repeats
 * (e.g. dropping coins) overlap instead of cutting each other off.
 */
export type SoundName =
  | 'coinDrop'
  | 'coinAdvance'
  | 'handlePush'
  | 'handlePull'
  | 'cardTake'
  | 'cardFlip';

/**
 * Stable public URLs for each clip. Files live in `public/sfx/` so they are served
 * verbatim at the site root and fetched by this fixed path (NOT imported through the
 * bundler). These filenames are the contract: swap the file contents to change a
 * sound without touching code.
 *
 * A value may be a SINGLE url or an ARRAY of urls. An array is a variant POOL: each
 * play() picks one at random, so a repeated action (dropping four quarters in a row)
 * does not sound like the identical sample on a loop. The real coin-drop foley was cut
 * into three takes from the source recording for exactly this reason.
 */
const SOUND_FILES: Record<SoundName, string | readonly string[]> = {
  coinDrop: [asset('/sfx/coin-drop-1.mp3'), asset('/sfx/coin-drop-2.mp3'), asset('/sfx/coin-drop-3.mp3')],
  coinAdvance: asset('/sfx/coin-advance.mp3'),
  handlePush: asset('/sfx/handle-push.mp3'),
  handlePull: asset('/sfx/handle-pull.mp3'),
  cardTake: [asset('/sfx/card-take-1.mp3'), asset('/sfx/card-take-2.mp3')],
  cardFlip: asset('/sfx/card-flip.mp3'),
};

const DEFAULT_VOLUME = 0.8;

/**
 * A small buffer-pool sound player. Created once as a module-level singleton; the
 * AudioContext is built lazily on first use so the browser autoplay policy is
 * satisfied (the first interaction in this app is itself a click).
 */
class SoundBoard {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  // One sound maps to one OR MORE decoded buffers (a variant pool). play() picks a
  // random member; a single-file sound is just a pool of length 1.
  private readonly buffers = new Map<SoundName, AudioBuffer[]>();
  private muted = false;
  private volume = DEFAULT_VOLUME;

  /**
   * Lazily create the shared AudioContext and master gain node. Browsers start the
   * context suspended until a user gesture; callers resume it defensively.
   *
   * Returns:
   *   The shared context and the master gain node all sources route through.
   */
  private ensureContext(): { context: AudioContext; master: GainNode } {
    if (this.context && this.master) {
      return { context: this.context, master: this.master };
    }
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = this.muted ? 0 : this.volume;
    master.connect(context.destination);
    this.context = context;
    this.master = master;
    return { context, master };
  }

  /**
   * Fetch and decode every clip once into the buffer cache. Safe to call eagerly on
   * mount: decoding needs no running context, and play() drops silently for any clip
   * not yet decoded, so the first interaction is never blocked on this completing.
   * Missing files are skipped (so absent placeholders never crash the app).
   */
  async preload(): Promise<void> {
    const { context } = this.ensureContext();
    const entries = Object.entries(SOUND_FILES) as [SoundName, string | readonly string[]][];
    await Promise.all(
      entries.map(async ([name, value]) => {
        if (this.buffers.has(name)) return;
        const urls = Array.isArray(value) ? value : [value];
        const decoded = await Promise.all(
          urls.map(async (url) => {
            try {
              const response = await fetch(url);
              if (!response.ok) return null; // file not present yet; stay silent
              const data = await response.arrayBuffer();
              return await context.decodeAudioData(data);
            } catch {
              // Network/decoding failure for one variant must not break the rest.
              return null;
            }
          }),
        );
        const ready = decoded.filter((buffer): buffer is AudioBuffer => buffer !== null);
        if (ready.length > 0) this.buffers.set(name, ready);
      }),
    );
  }

  /**
   * Play a clip. Drops silently if its buffer is not loaded yet. Each call spawns a
   * new single-use source node, so overlapping plays of the same sound are fine.
   *
   * Args:
   *   name: Which clip to play.
   */
  play(name: SoundName): void {
    const pool = this.buffers.get(name);
    if (!pool || pool.length === 0) return;
    // Pick a random variant so repeated plays (four quarters in a row) don't sound
    // like one looped sample. A single-file sound trivially always picks index 0.
    const buffer = pool[Math.floor(Math.random() * pool.length)];
    const { context, master } = this.ensureContext();
    if (context.state === 'suspended') {
      void context.resume(); // unlock on first gesture; no-op once running
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    source.start(0);
  }

  /**
   * Mute or unmute all sound. Muting sets the master gain to 0 but keeps the stored
   * volume so unmuting restores it.
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  /**
   * Set the master volume (0..1). Takes effect immediately unless muted.
   */
  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master && !this.muted) this.master.gain.value = volume;
  }
}

/** Module-level singleton: one audio engine shared across the whole app. */
export const soundBoard = new SoundBoard();

/**
 * Preload all clips once when the app mounts. Runs in the background; play() degrades
 * gracefully for any clip still decoding.
 */
export function usePreloadSounds(): void {
  useEffect(() => {
    void soundBoard.preload();
  }, []);
}
