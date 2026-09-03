/**
 * What the scripts are told about the machine they are running on.
 *
 * Two reserved variables, and the game reads both. They are the half of the
 * graphics work that has nothing to do with pixels: a display driver decides
 * what the game *looks* like, and these decide what the game *does*.
 *
 * ## What the scripts actually ask
 *
 * Measured from the bundled game rather than assumed, by disassembling all 46
 * LOGIC resources and reading every branch:
 *
 * ```text
 * tests of the monitor variable (26)   27, at 26 sites
 * of which "is this mono?"             26, all of them `equaln(26, 2)`
 * the twenty-seventh                   logic 0: an IBM PC that is neither
 *                                      mono nor EGA -- which is to say CGA
 * tests of the computer variable (20)  10 sites, in logics 0, 51 and 55
 * ```
 *
 * The plan expected the computer type to be read only by the help screen. It
 * is not: logic 51 binds different keys for it and logic 0 builds a different
 * menu, and those are the two that can be seen without reading a help page.
 *
 * What the computer-type branches do, which is what makes any of this
 * checkable:
 *
 * ```text
 * logic  0: 89   IBM PC + neither mono nor EGA  adds "Graphics Mode <Ctrl-R>"
 * logic  0: 119  computer type 5                has no Speed menu
 * logic  0: 334  computer type 2                the only one with volume keys
 * logic 51: 57   computer types 0-3             set flag 102; the rest set 101
 * logic 51: 210  computer type 2                gets `=` `-` `+`, the volume keys
 * logic 51: 233  computer type 5                Escape on another controller
 * logic 51: 307  computer type 1                gets the digit keys 1-0
 * logic 55: ...  computer types 4, 5, 6, 7      four different help pages
 * ```
 *
 * Two of those are worth reading twice. Type 1 is the only machine given the
 * number keys, and the controllers it binds them to are the ones every other
 * machine reaches with F1 to F10 -- which is a PCjr, whose chiclet keyboard
 * had no function keys. Type 2 is the only machine given volume keys, and the
 * PCjr sound chip is the only one in this list whose volume can be changed at
 * all -- which is a Tandy 1000. The game's own branches name the two machines
 * more precisely than the documentation does.
 *
 * The 0-3 against 4-7 split at logic 51:57 is the useful corroboration. The
 * AGI documentation lists the computer types as the PC family first and the
 * ports afterwards, and a game that groups exactly 0 to 3 together and gives
 * 4, 5 and 6/7 their own help pages is a game that agrees with that list.
 *
 * ## What "is this mono?" changes
 *
 * All twenty-six of those sites, and none of them moves the engine's own
 * layout. What they do is use the screen differently:
 *
 * ```text
 * logic  1: 195  drops a line       the opening credits, on rows 23 and 24
 * logic  0: 867  drops a line       the speed indicator, on row 24
 * logic 58:  55  moves a line       row 21 in colour, row 24 in mono
 * logic 38: 1412 moves a line       row 23 in colour, row 24 in mono
 * logic 22: 1228 narrows a field    38 characters in colour, 28 in mono
 * logic 38: 32   loads another view view 151 in colour, view 146 in mono
 * logic 38: 59   and shows it       the same pair, on object 15
 * ```
 *
 * So the engine's part is not to lay the screen out differently. It is to tell
 * the truth about the monitor and let the scripts do it -- which is why this is
 * a milestone about two variables rather than about the renderer.
 *
 * ## Where the values come from
 *
 * The numbers themselves are the documentation's, not this game's -- a branch
 * says *that* the game distinguishes a value, never what the value is called.
 * They are corroborated where the game corroborates them and taken on trust
 * where it does not, and the difference is marked below.
 */
import type { SoundChip } from '../audio/output.ts';
import type { DisplayMode } from '../render/drivers/driver.ts';

/**
 * Values of the monitor variable, 26.
 *
 * `MONO` is the one the game cares about, twenty-six times over. `CGA` is
 * corroborated by logic 0:89, which asks for an adapter that is neither mono
 * nor EGA and offers it a graphics-mode toggle -- a thing only a composite CGA
 * screen has any use for. `RGB` is the PCjr's, and is the one value here the
 * game never distinguishes.
 */
export const MONITOR = {
  CGA: 0,
  RGB: 1,
  MONO: 2,
  EGA: 3,
} as const;

/**
 * Values of the computer variable, 20.
 *
 * Only the three the shell can offer. The game knows of eight, and the other
 * five are the ports -- an Atari ST, an Amiga, a Macintosh, an Apple IIgs --
 * which this engine is not and will not claim to be.
 */
export const COMPUTER = {
  IBM_PC: 0,
  PCJR: 1,
  TANDY: 2,
} as const;

/** What a display mode means to the scripts. */
export function monitorTypeFor(mode: DisplayMode): number {
  switch (mode) {
    case 'cga':
      return MONITOR.CGA;
    case 'pcjr':
      return MONITOR.RGB;
    case 'hercules':
      return MONITOR.MONO;
    case 'ega':
      return MONITOR.EGA;
  }
}

/**
 * Which machine the shell's two choices add up to.
 *
 * The computer type is a separate variable from the monitor, and the shell has
 * no separate control for it -- so it is inferred from the pair, which is the
 * only place the two choices meet:
 *
 * ```text
 * a PCjr display          a PCjr        -- its RGB mode is its display
 * PCjr sound, other pixels a Tandy      -- a Tandy 1000 is exactly this: the
 *                                          PCjr's sound chip, ordinary graphics
 * anything else           an IBM PC
 * ```
 *
 * Inferring rather than asking is a decision, and it is the one that keeps the
 * shell honest: a third select saying "Computer" would let a player describe a
 * machine that never existed -- a PCjr with a PC speaker -- and the game would
 * then be told something untrue about the hardware it is running on.
 */
export function computerTypeFor(mode: DisplayMode, chip: SoundChip): number {
  if (mode === 'pcjr') return COMPUTER.PCJR;
  if (chip === 'pcjr') return COMPUTER.TANDY;
  return COMPUTER.IBM_PC;
}
