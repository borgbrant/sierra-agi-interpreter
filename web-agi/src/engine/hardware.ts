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
 * ## The PCjr, and why it is not offered
 *
 * The original shipped `JR_GRAF.OVL` and the shell offered a PCjr to match it.
 * It is gone, and the measurements above are the argument for taking it out.
 *
 * A PCjr differs from an EGA in three places, and two of them are empty. Its
 * pixels are identical: the 160x200 mode is the sixteen-colour palette AGI was
 * drawn for, so there was never a driver to build. Its monitor value, 1, is
 * distinguished by no branch in the game -- the twenty-six mono tests ask for
 * 2, and logic 0:89 is guarded by `equaln(20, 0)`, which a PCjr fails. What is
 * left is the third: computer type 1 binds the digit keys 1-0, at logic 51:307,
 * to the controllers every other machine reaches with F1 to F10.
 *
 * A *graphics* mode whose entire effect is a keyboard mapping is not a graphics
 * mode, and a select offering four modes of which one can never look different
 * from another misdescribes what the engine can do. So the choice is three
 * modes that mean three things.
 *
 * What that costs is one real behaviour, recorded here so it is not lost: a
 * PCjr's chiclet keyboard had no function keys, and the game knew it and bound
 * the number row instead. Reaching it again needs computer type 1 to be
 * settable, which is a *computer* to choose rather than a monitor -- and the
 * day this engine offers that choice, the PCjr is the first entry on the list.
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
 * screen has any use for.
 *
 * Value 1 is the PCjr's RGB monitor, and it is not here. The bundled game never
 * distinguishes it: it is neither `MONO` nor the `equaln(20, 0)` that guards
 * logic 0:89, so every branch it reaches is the branch EGA reaches. See
 * *The PCjr* below.
 */
export const MONITOR = {
  CGA: 0,
  MONO: 2,
  EGA: 3,
} as const;

/**
 * Values of the computer variable, 20.
 *
 * Only the two the shell can offer. The game knows of eight: value 1 is the
 * PCjr, and the remaining five are the ports -- an Atari ST, an Amiga, a
 * Macintosh, an Apple IIgs -- which this engine is not and will not claim to
 * be.
 */
export const COMPUTER = {
  IBM_PC: 0,
  TANDY: 2,
} as const;

/** What a display mode means to the scripts. */
export function monitorTypeFor(mode: DisplayMode): number {
  switch (mode) {
    case 'cga':
      return MONITOR.CGA;
    case 'hercules':
      return MONITOR.MONO;
    case 'ega':
      return MONITOR.EGA;
  }
}

/**
 * Whether the display leaves a row for the command line.
 *
 * A geometric fact rather than a preference, and the arithmetic is the picture
 * against the display's character cell: CGA and EGA draw the picture's 168 rows
 * in 8-row cells, so it covers the grid's rows 1 to 21 and the input row at 23
 * is clear. Hercules draws them in 14-row cells -- 336 device rows, the grid's
 * rows 1 to 24 -- so there is no row left and the command line becomes a box.
 *
 * Kept here beside {@link monitorTypeFor} because it is the same kind of thing:
 * what a display mode means to the engine above the seam. It is deliberately
 * *not* keyed on the monitor variable. M13 keyed it there, on the reasoning that
 * Hercules was the only monochrome display -- and M16 gave CGA a monochrome
 * mode of its own, which has all 25 rows and needs its input row back. The
 * original agreed: a CGA in 640x200 drew the command line on a row.
 */
export function hasInputRow(mode: DisplayMode): boolean {
  return mode !== 'hercules';
}

/**
 * Which machine the shell's choices add up to.
 *
 * The computer type is a separate variable from the monitor, and the shell has
 * no separate control for it -- so it is inferred, and with the PCjr not on
 * offer there is only one thing left to infer it from:
 *
 * ```text
 * the PCjr sound chip   a Tandy 1000 -- which is exactly that: the PCjr's
 *                       sound chip, and ordinary graphics
 * a PC speaker          an IBM PC
 * ```
 *
 * Inferring rather than asking is a decision, and it is the one that keeps the
 * shell honest. A third select saying "Computer" would let a player describe a
 * machine that never existed, and the game would then be told something untrue
 * about the hardware it is running on.
 */
export function computerTypeFor(chip: SoundChip): number {
  return chip === 'pcjr' ? COMPUTER.TANDY : COMPUTER.IBM_PC;
}
