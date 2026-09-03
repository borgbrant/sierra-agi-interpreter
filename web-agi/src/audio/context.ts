/**
 * Creating an AudioContext, which the browser will not let happen on request.
 *
 * An AudioContext made before the player has interacted with the page starts
 * suspended, and a game that begins cycling the moment it loads would play its
 * opening sound into a dead context. So the context is created on the first
 * key or click and handed to the player then; until that happens the engine
 * runs against the silent output, which keeps every sound's *timing* and
 * simply makes no noise.
 *
 * This is the whole of the DOM's involvement in sound.
 */
import { WebAudioOutput, type SoundOutput } from './output.ts';

type ContextConstructor = typeof AudioContext;

/** Safari still only has the prefixed constructor. */
function audioContextConstructor(): ContextConstructor | null {
  const scope = window as unknown as {
    AudioContext?: ContextConstructor;
    webkitAudioContext?: ContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/**
 * Wait for the player to touch the page, and give the sound somewhere to go.
 *
 * Resolves once the gesture has arrived and the context is made -- or at once
 * if the browser has no WebAudio at all, since a game with no sound should
 * still start. The caller waits for this before running the first cycle, which
 * is the only way the game's opening theme is ever heard: it starts on cycle 1,
 * and the first gesture a player makes is usually the key that skips the title
 * and takes the music with it.
 *
 * The gesture is consumed rather than passed on, so the key that wakes the page
 * does not also press something in the game.
 */
export function audioReady(): Promise<SoundOutput | null> {
  const events = ['keydown', 'pointerdown'] as const;

  return new Promise((resolve) => {
    const start = () => {
      for (const event of events) window.removeEventListener(event, start, true);

      const Constructor = audioContextConstructor();
      // No WebAudio at all is not a failure: the game plays, silently.
      if (!Constructor) {
        resolve(null);
        return;
      }

      const context = new Constructor();
      // Created inside a gesture it should already be running, but a context
      // restored with the page can come back suspended.
      if (context.state === 'suspended') void context.resume();

      resolve(new WebAudioOutput(context));
    };

    // Captured, so the gesture is taken before the game's own key handling.
    for (const event of events) window.addEventListener(event, start, { capture: true, once: true });
  });
}
