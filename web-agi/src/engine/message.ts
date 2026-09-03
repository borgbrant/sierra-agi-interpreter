/**
 * Message text, with its substitutions resolved.
 *
 * AGI messages are templates. `"You are carrying %o5"` is not a string the
 * author wrote out in full -- the interpreter has to fetch the object's name at
 * the moment the message is shown. The substitutions are:
 *
 * ```text
 * %v<n>      the value of variable n, optionally %v<n>|<width> to pad it
 * %m<n>      message n of the script that is running
 * %g<n>      message n of logic 0, the messages every script can reach
 * %o<n>      the name of inventory item n
 * %s<n>      the value of string n
 * %w<n>      word n of what the player last typed, counting from 1
 * ```
 *
 * They nest: a message can substitute another message that substitutes a
 * variable. That is not decoration -- the bundled game's own text does it -- so
 * expansion is recursive, with a depth limit rather than a trust in the data.
 */
import type { Machine } from './machine.ts';

/** How deep one message may reach through other messages. */
const MAX_DEPTH = 8;

/**
 * Expand a message's substitutions.
 *
 * @param machine the machine whose state the values come from
 * @param text    the raw message
 */
export function formatMessage(machine: Machine, text: string, depth = 0): string {
  if (depth > MAX_DEPTH) return text;

  let out = '';
  let at = 0;

  while (at < text.length) {
    const percent = text.indexOf('%', at);
    if (percent === -1 || percent === text.length - 1) {
      out += text.slice(at);
      break;
    }

    out += text.slice(at, percent);

    const kind = text[percent + 1]!;
    const { number, next } = readNumber(text, percent + 2);

    if (number === null) {
      // Not a substitution after all: keep the percent sign as written.
      out += '%';
      at = percent + 1;
      continue;
    }

    at = next;

    switch (kind) {
      case 'v': {
        // A width may follow, as %v30|3, and pads the value on the left.
        let value = String(machine.state.getVar(number));
        if (text[at] === '|') {
          const width = readNumber(text, at + 1);
          if (width.number !== null) {
            at = width.next;
            value = value.padStart(width.number, '0');
          }
        }
        out += value;
        break;
      }
      case 'm':
        out += formatMessage(machine, machine.message(number) ?? '', depth + 1);
        break;
      case 'g':
        out += formatMessage(machine, machine.globalMessage(number) ?? '', depth + 1);
        break;
      case 'o':
        // Item numbers in messages count from 1; item 0 is the first item.
        out += machine.inventory.nameOf(number - 1);
        break;
      case 's':
        out += machine.state.getString(number);
        break;
      case 'w':
        out += machine.parsedWords[number - 1]?.word ?? '';
        break;
      default:
        // An escape the interpreter does not know is left alone rather than
        // swallowed, so it shows up on screen instead of vanishing silently.
        out += `%${kind}${number}`;
        break;
    }
  }

  return out;
}

/** Read the digits at a position. */
function readNumber(text: string, at: number): { number: number | null; next: number } {
  let end = at;
  while (end < text.length && text[end]! >= '0' && text[end]! <= '9') end++;
  if (end === at) return { number: null, next: at };
  return { number: Number(text.slice(at, end)), next: end };
}
