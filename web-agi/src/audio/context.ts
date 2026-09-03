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
import { WebAudioOutput } from './output.ts';
import type { SoundPlayer } from './player.ts';

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
 * Attach an audio context to the player at the first user gesture.
 *
 * @returns a function that removes the listeners, for completeness; the
 *          listeners remove themselves once they have run.
 */
export function enableAudioOnGesture(player: SoundPlayer): () => void {
  const events = ['keydown', 'pointerdown'] as const;

  const start = () => {
    stop();

    const Constructor = audioContextConstructor();
    // No WebAudio at all is not a failure: the game plays, silently.
    if (!Constructor) return;

    const context = new Constructor();
    player.setOutput(new WebAudioOutput(context));

    // Created inside a gesture it should already be running, but a context
    // restored with the page can come back suspended.
    if (context.state === 'suspended') void context.resume();
  };

  const stop = () => {
    for (const event of events) window.removeEventListener(event, start);
  };

  for (const event of events) window.addEventListener(event, start, { once: true });
  return stop;
}
