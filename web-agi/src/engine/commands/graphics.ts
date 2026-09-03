/**
 * Drawing commands.
 *
 * AGI keeps two pictures: the one being built up, and the one on screen.
 * `draw.pic` composes into the former and `show.pic` publishes it, which is why
 * a room can assemble itself without the player watching it happen.
 *
 * Picture commands name a *variable* holding the picture number, not the number
 * itself -- scripts do `assignn(202, 2)` then `load.pic(202)`.
 */
import { Screens } from '../../render/screens.ts';
import type { Handler } from '../machine.ts';

export const GRAPHICS: Record<string, Handler> = {
  'load.pic': (m, [v]) => {
    m.loadedPictures.add(m.state.getVar(v!));
  },

  'draw.pic': (m, [v]) => {
    const id = m.state.getVar(v!);
    const drawn = Screens.fromPicture(m.resources.loadSync('pic', id));
    m.background.copyFrom(drawn);
    m.currentPicture = id;
    // Nothing on the old picture is worth putting back -- neither the sprites'
    // saved rectangles nor the scenery a script added to the picture before it.
    m.savedAreas.length = 0;
    m.scenery.length = 0;
  },

  'overlay.pic': (m, [v]) => {
    // An overlay draws onto what is already there rather than replacing it.
    const id = m.state.getVar(v!);
    const drawn = Screens.fromPicture(m.resources.loadSync('pic', id));
    for (let i = 0; i < drawn.visual.length; i++) {
      if (drawn.visual[i] !== 15) m.background.visual[i] = drawn.visual[i]!;
      if (drawn.priority[i] !== 4) m.background.priority[i] = drawn.priority[i]!;
    }
    m.savedAreas.length = 0;
  },

  'discard.pic': (m, [v]) => {
    m.loadedPictures.delete(m.state.getVar(v!));
  },

  'show.pic': (m) => {
    m.screens.copyFrom(m.background);
    m.savedAreas.length = 0;
    m.pictureShown = true;
    // And nothing of the last room's text is left on it. AGI has one
    // framebuffer, so publishing the picture writes over whatever was there --
    // captions, and the black band a script paints to put them on. Without
    // this the band survives every room the player walks into, which no
    // photograph of the real thing shows.
    //
    // Safe as well as faithful, and it was checked rather than assumed: no
    // script in the game writes with `display` and then shows the picture, so
    // nothing it meant to keep is thrown away here.
    m.textLayer.clear();
  },

  // A debugging command in the original. The engine offers the same view
  // through the debug overlay, so the script's request is simply noted.
  'show.pri.screen': (m) => {
    m.stub('show.pri.screen');
  },
};
