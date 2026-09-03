/**
 * Text: windows, the status line, and the questions the game asks.
 *
 * Two kinds of text land on screen and they behave differently. A *window* is a
 * box drawn over the picture, sized to its message, and normally the game stops
 * until the player dismisses it. `display` text is not a window at all: it is
 * written straight into character cells and stays there until something clears
 * it, which is how a game puts a permanent label on the screen.
 *
 * Every message goes through {@link formatMessage} first. A raw message is a
 * template, and printing one unexpanded shows the player `%v3` where the score
 * should be.
 */
import { DEFAULT_CURSOR } from '../../input/prompt.ts';
import { layOutWindow, WINDOW_TEXT_WIDTH } from '../../render/text.ts';
import { MessageWindow, NumberQuestion, StringQuestion } from '../interaction.ts';
import type { Handler, Machine } from '../machine.ts';
import { formatMessage } from '../message.ts';
import { FLAG, VAR } from '../state.ts';

/** A message of the running script, with its substitutions resolved. */
function text(m: Machine, number: number): string {
  return formatMessage(m, m.message(number) ?? '');
}

/**
 * Show a message.
 *
 * Normally the game waits for the player, and the window is returned so the
 * machine can park on it. With the "leave the window open" flag set the script
 * carries straight on and the window stays up until something closes it, so
 * nothing is returned and there is nothing to wait for.
 */
function show(m: Machine, message: string, column?: number, row?: number, width?: number) {
  // Deliberately not the machine's text colours. `set.text.attribute` colours
  // text written into character cells -- `display` text, the status line -- and
  // a game that has left it on something else would otherwise turn its next
  // message box that colour. Message boxes are black on white throughout the
  // original, whatever the attribute happens to be.
  const window = layOutWindow(message, {
    width: width ?? WINDOW_TEXT_WIDTH,
    column,
    row,
  });

  if (m.state.getFlag(FLAG.LEAVE_WINDOW_OPEN)) {
    m.window = window;
    // The flag covers one message, not every message from now on. The game
    // sets it immediately before each print it does not want to wait for --
    // which is the evidence that it is cleared here: setting it once would
    // otherwise be enough. Leaving it set makes every later message
    // non-blocking and strands the last one on screen for good.
    m.state.setFlag(FLAG.LEAVE_WINDOW_OPEN, false);
    return undefined;
  }

  m.window = null;
  return new MessageWindow(window, m.state.getVar(VAR.WINDOW_CLOSE_DELAY));
}

export const TEXT: Record<string, Handler> = {
  // --- windows -----------------------------------------------------------
  print: (m, [message]) => show(m, text(m, message!)),
  'print.v': (m, [v]) => show(m, text(m, m.state.getVar(v!))),

  // print.at names its own position and width, for a message that has to sit
  // somewhere particular rather than in the middle of the screen.
  'print.at': (m, [message, row, column, width]) =>
    show(m, text(m, message!), column!, row!, width === 0 ? WINDOW_TEXT_WIDTH : width!),
  'print.at.v': (m, [v, row, column, width]) =>
    show(m, text(m, m.state.getVar(v!)), column!, row!, width === 0 ? WINDOW_TEXT_WIDTH : width!),

  'close.window': (m) => {
    m.window = null;
  },

  // Dialogue boxes are a v3 feature the bundled game never opens; the commands
  // exist so a script that brackets text with them still sequences correctly.
  'open.dialogue': () => {},
  'close.dialogue': () => {},

  // --- text written onto the screen --------------------------------------
  display: (m, [row, column, message]) =>
    m.textLayer.write(text(m, message!), column!, row!, m.textForeground, m.textBackground),
  'display.v': (m, [vrow, vcolumn, vmessage]) =>
    m.textLayer.write(
      text(m, m.state.getVar(vmessage!)),
      m.state.getVar(vcolumn!),
      m.state.getVar(vrow!),
      m.textForeground,
      m.textBackground,
    ),

  // Clearing to the background colour empties the cells instead of painting
  // them, so a caption taken off the picture reveals the scene rather than
  // leaving a coloured hole in it.
  'clear.lines': (m, [from, to, colour]) => {
    if (colour === m.textBackground) m.textLayer.erase(0, from!, 39, to!);
    else m.textLayer.fillRows(from!, to!, colour!);
  },

  'clear.text.rect': (m, [row1, column1, row2, column2, colour]) => {
    if (colour === m.textBackground) m.textLayer.erase(column1!, row1!, column2!, row2!);
    else m.textLayer.fillCells(column1!, row1!, column2!, row2!, colour!);
  },

  'set.text.attribute': (m, [foreground, background]) => {
    m.textForeground = foreground!;
    m.textBackground = background!;
  },

  'set.cursor.char': (m, [message]) => {
    // The cursor, not the marker the line starts with: that one lives in string
    // 0. This game sets the cursor to `_` and the string to `]`, and using one
    // for the other gives an input line reading `__`.
    m.prompt.cursorChar = (m.message(message!) ?? DEFAULT_CURSOR).charAt(0) || ' ';
  },

  // The full-screen text mode is only used by the original for its error and
  // menu screens; the engine has no separate mode, so this clears the picture
  // area to the text background instead of switching buffers.
  'text.screen': (m) => {
    m.textMode = true;
  },
  graphics: (m) => {
    m.textMode = false;
  },

  // --- asking the player -------------------------------------------------
  'get.num': (m, [message, variable]) => new NumberQuestion(text(m, message!), variable!),

  'get.string': (m, [index, message, row, column, maxLength]) =>
    new StringQuestion(
      text(m, message!),
      index!,
      maxLength === 0 ? 40 : maxLength!,
      column === 0 ? undefined : column!,
      row === 0 ? undefined : row!,
    ),

  // --- the command line --------------------------------------------------
  'word.to.string': (m, [index, word]) => {
    m.state.setString(index!, m.parsedWords[word! - 1]?.word ?? '');
  },

  parse: (m, [index]) => {
    // Re-parse a string as though the player had typed it. Games use this to
    // act on a command they assembled themselves.
    m.submitLine(m.state.getString(index!));
  },

  'echo.line': (m) => {
    m.prompt.text = m.lastLine;
  },
  'cancel.line': (m) => m.prompt.clear(),

  pause: (m) =>
    show(m, '  Game paused.\n\nPress ENTER to continue.'),

  // --- screen furniture --------------------------------------------------
  'status.line.on': (m) => {
    m.statusLineVisible = true;
  },
  'status.line.off': (m) => {
    m.statusLineVisible = false;
  },

  // The screen layout is fixed at the original's 40x25, so a script asking for
  // the layout it already has is accepted and ignored.
  'configure.screen': () => {},
  'set.upper.left': () => {},
  'shake.screen': () => {},
};
