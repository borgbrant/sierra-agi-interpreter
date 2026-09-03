/**
 * Creating an AudioContext, which the browser will not let happen on request.
 *
 * An AudioContext made before the player has interacted with the page starts
 * suspended, so one is made at the first key or click and handed to the player
 * then. Until that happens the engine runs against the silent output, which
 * keeps every sound's *timing* and simply makes no noise -- and the game starts
 * with its sound switched off, so what a player sees agrees with what they
 * hear.
 *
 * The gesture is watched, not taken: the game is already running by then, and a
 * keypress swallowed here would be a keypress the game never sees.
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
 * Resolves once the gesture has arrived and the context is made -- or at once if
 * the browser has no WebAudio at all, since a game with no sound should still
 * play. Nothing waits on it: the game runs from the moment it loads, and a
 * sound already playing when the context turns up is handed to it at the point
 * it has reached.
 */
export function audioReady(): Promise<SoundOutput | null> {
  const events = ['keydown', 'pointerdown'] as const;

  return new Promise((resolve) => {
    const start = () => {
      for (const event of events) window.removeEventListener(event, start);

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

    // Watched rather than captured: the game is running and needs its keys.
    for (const event of events) window.addEventListener(event, start, { once: true });
  });
}
