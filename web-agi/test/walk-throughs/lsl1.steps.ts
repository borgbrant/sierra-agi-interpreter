/**
 * `lsl1.md` as engine input.
 *
 * The markdown beside this file is the walk-through: what the player types and
 * what it pays. This is the same path in the form a test can run, and it adds
 * the things the source does not have -- the rooms the path passes through, the
 * way between them, the places in a room a line has to be said from, and the
 * three sessions at the blackjack table that pay for all of it. Kept beside the
 * prose rather than in the test so that the two can be read against each other.
 *
 * The numbers in the comments are the row of the table each step comes from,
 * and a step with no number is something the source leaves to the player.
 * Where the source is wrong the comment says so and plays what the game
 * actually wants; `lsl1.md` records the same two corrections beside its table.
 *
 * The coordinates are not guesses. Every one of them is a `posn` box out of the
 * room's own logic, quoted in the comment beside it, because half the lines in
 * this walk-through are answered with "You're not close enough" from anywhere
 * else and no source records where "else" ends.
 */
import type { Playthrough, Step } from '../helpers/playthrough.ts';

/** Rooms the path visits, by the name the sibling walk-through gives them. */
export const ROOM = {
  cab: 10,
  street: 11,
  restroom: 13,
  hallway: 14,
  leftys: 15,
  pimps: 16,
  bedroom: 17,
  alley: 12,
  store: 21,
  outsideStore: 22,
  outsideDisco: 23,
  disco: 24,
  discoTable: 25,
  casino: 31,
  outsideCasino: 32,
  outsideChapel: 33,
  chapel: 34,
  lobby: 35,
  slots: 37,
  blackjack: 38,
  landing: 40,
  honeymoonSuite: 41,
  penthouse: 42,
  hotTub: 43,
  livingRoom: 44,
  closet: 45,
} as const;

/**
 * A taxi ride, which the walk-through takes eight times.
 *
 * Always the same five lines -- call it, get in, name the place, pay, get out
 * -- so they are written once. The one thing the source does not say is where
 * to stand: logic 57 will only let Larry into the cab from a box by the kerb,
 * `posn(0,70,155,90,167)` outside Lefty's and `posn(0,70,140,90,166)`
 * everywhere else, and the corner they share is where this stands him.
 *
 * The long wait is the ride itself. Paying before the cab arrives is answered
 * with "Why don'cha wait'll we git there, buddy?", and the fare then goes
 * unpaid -- which the cabbie settles by running Larry over as he gets out.
 */
export const cabTo = (destination: string, arrivesAt: number, points?: number): Step[] => [
  // Standing at the kerb before whistling, not after: the cab waits about a
  // hundred cycles and then drives off, which is not long enough to cross the
  // forecourt outside the casino.
  { walk: [78, 160], within: 2 },
  { say: 'call cab' },
  { wait: 80 },
  { say: 'enter cab', enters: ROOM.cab },
  { wait: 60 },
  { say: destination },
  { wait: 400 },
  { say: 'pay driver' },
  { wait: 100 },
  points === undefined ? { say: 'get out' } : { say: 'get out', points },
  { wait: 40 },
];

/**
 * Lefty's: the bar, the back passage and the restroom. Steps 1 to 13.
 *
 * The scoring lines are the walk-through's own. The lines that pay nothing are
 * kept because what follows depends on them -- Larry has to be sitting to
 * order a drink -- and are judged by what the game answers, or by the room
 * they lead to. A door is always judged by the room: "Move closer to the
 * handle" is a brush-off that mentions the handle, and a test that reads it as
 * success has not opened the door.
 */
export const LEFTYS: readonly Step[] = [
  { say: 'open door', enters: ROOM.leftys }, // 1: in off the street
  { wait: 30 },
  { say: 'sit down', expect: /sitting/i }, // 2
  { say: 'order whiskey', points: 1 }, // 3
  { say: 'get up', expect: /standing/i }, // 4
  { go: 'north' }, // through to the back passage, where the drunk is
  { say: 'take rose', points: 1 }, // 5
  { say: 'give whiskey', points: 2 }, // 6
  { say: 'open door', enters: ROOM.restroom }, // 7
  { wait: 30 },
  { say: 'read wall', points: 2 }, // 8: the password is written on it
  { say: 'look sink', expect: /ring/i }, // 9
  { say: 'take ring', points: 3 }, // 10
  { say: 'use toilet', points: 1 }, // 11
  { wait: 40 },
  { say: 'get up', expect: /duties|standing/i }, // 12
  { say: 'open door', enters: ROOM.hallway }, // 13
  { wait: 30 },
];

/** The walk-through's own running total once Lefty's is done. */
export const AFTER_LEFTYS = 10;

/**
 * Out of Lefty's and across town by cab. Steps 14 to 18.
 *
 * The one coordinate in this file, and it is the game's own: logic 57 sets the
 * flag that means "close enough to the cab" from `posn(0,70,155,90,167)`, and
 * without standing in that box "enter cab" is answered with "You're not close
 * enough" however long the cab waits. The walk-through says none of this, and
 * neither does the harness's wandering -- the cab drives off first.
 *
 * The waits are the cab's timing: it takes the player's control away while it
 * pulls up, and it leaves again after about two hundred cycles.
 */
export const TO_THE_STORE: readonly Step[] = [
  { go: 'south' }, // out of the back passage, into the bar
  { go: 'south', enters: ROOM.street }, // and out onto the street
  ...cabTo('store', ROOM.outsideStore, 1), // 14 to 18
];

/** The running total once the cab has been paid off outside the store. */
export const AFTER_THE_CAB = 11;

/**
 * Outside the store: the pay phone. Steps 19 to 21.
 *
 * The survey on the other end of the line asks five questions of its own,
 * which no walk-through records because they pay nothing and any answer will
 * do -- pressing return through them is what pays the two points the table
 * gives step 21.
 */
export const THE_PAY_PHONE: readonly Step[] = [
  { say: 'look phone', points: 1 }, // 19
  { say: 'use phone' }, // 20
  { say: '555-6969' }, // 21: the sex survey
  { answer: '', times: 6 },
];

/** The running total once the survey has been sat through. */
export const AFTER_THE_PHONE = 14;

/**
 * The convenience store, and the pay phone after it. Steps 22 to 25.
 *
 * Two coordinates, and both are the game's own. The wine is only within reach
 * from `posn(0,50,112,81,116)`, the shelf it stands on; and the clerk will
 * only be spoken to while flag 0 is set, which logic 21 arranges by painting
 * the floor in front of the counter with the water control colour. Hence the
 * `swims` step: without it the harness's route planner treats the whole of the
 * counter as somewhere Larry must not walk, and every line is answered with
 * "You're not close enough."
 *
 * Buying a condom is a five-question interrogation the walk-through does not
 * record, because no answer is wrong -- the clerk broadcasts whichever
 * combination is picked to the rest of the shop. The four points arrive with
 * the package, several seconds after the last answer, so they hang on the wait
 * rather than on a typed line.
 */
export const THE_STORE: readonly Step[] = [
  { go: 'north', enters: ROOM.store }, // in through the store door
  { swims: true },
  { walk: [55, 114], within: 2 },
  { say: 'take wine', points: 1 }, // 22
  { walk: [30, 142], within: 2 }, // to the counter, on the water
  { say: 'buy condom' }, // 23
  { say: 'smooth' },
  { say: 'colored' },
  { say: 'lubricated' },
  { say: 'striped' },
  { say: 'peppermint' },
  { wait: 150, points: 4 }, // the clerk fetches it, and charges $6 for it
  { go: 'south' }, // back out onto the street
  { walk: [60, 140], within: 4 }, // within reach of the pay phone
  { wait: 80 }, // which starts ringing five seconds after Larry comes out
  { say: 'answer phone', points: 5 }, // 24
  { say: 'give wine', points: 5 }, // 25: and the drunk hands over his knife
];

/** The running total once the drunk has his wine. */
export const AFTER_THE_STORE = 29;

/**
 * Back to Lefty's, and past the pimp. Steps 26 to 35.
 *
 * The naugahyde door at the back of the bar is knocked on and answered with
 * the password read off the restroom wall at step 8. Behind it is the pimp,
 * who will not leave the foot of the stairs while there is nothing worth
 * watching on the television.
 *
 * The remote control is the drunk's, given up with the whiskey at step 6 --
 * the walk-through never says where it comes from. It only reaches the set
 * from the near half of the room, `v39` being ego's y and the script wanting
 * it no further down than 144.
 *
 * Eight presses, because the game starts on channel 14 and the pimp is only
 * held by channel 21, and the first press of the run is always swallowed
 * ("Slow down. You're gonna blow the punch line!") while the set warms up.
 * The eight points are not paid by the press: they come a moment later, when
 * the pimp gives up his post and wanders off to watch.
 */
export const TO_THE_PIMP: readonly Step[] = [
  ...cabTo('bar', ROOM.street), // 26 to 30
  { say: 'open door', enters: ROOM.leftys }, // 31
  { wait: 30 },
  { say: 'knock door', expect: /rap loudly/i }, // 32
  { wait: 60 },
  { say: 'ken sent me', enters: ROOM.pimps }, // 33
  { wait: 60 },
  { walk: [60, 138], within: 4 }, // within range of the television
  { say: 'use remote', points: 3 }, // 34
  ...Array.from({ length: 7 }, () => [{ say: 'change channel' }, { wait: 60 }] as Step[]).flat(),
  { say: 'change channel' },
  { wait: 150, points: 8 }, // 35
];

/** The running total once the pimp is watching television. */
export const AFTER_THE_PIMP = 40;

/**
 * Upstairs at Lefty's, and out of the window. Steps 36 to 46.
 *
 * Four places to stand, all of them the room's own boxes: the front of the bed
 * at `posn(0,11,144,48,151)`, the window at `posn(0,124,138,139,155)` -- which
 * is where the box of candy is, not the table it sits on -- and the sill at
 * `posn(0,116,118,137,139)`, which is the only spot the window opens from.
 *
 * The eleven points for step 39 are not paid when the line is typed. The game
 * takes control away and plays the whole thing out, so they hang on the wait
 * afterwards.
 *
 * The alley below is a fire escape with a ladder, and the walk-through does
 * not mention either: the way down is to stand at the head of the ladder,
 * `posn(0,53,60,54,64)`, and let the game climb Larry down it. What it does
 * not say either is where that lands him -- in the trash bin, which is why
 * steps 44 and 45 work as typed and step 46 is how he gets out again.
 */
export const THE_HOOKER: readonly Step[] = [
  { go: 'north', enters: ROOM.bedroom }, // up the stairs the pimp has left
  { wait: 60 },
  { walk: [30, 148], within: 2 }, // the front of the bed
  { say: 'use breath spray' }, // 36
  { wait: 60 }, // "Psssft. Psssft." and, a moment later, "Ahhh."
  { say: 'get naked' }, // 37
  { wait: 60 }, // undressing is animated, and nothing else takes until it ends
  { say: 'use condom', points: 10 }, // 38
  { say: 'fuck girl' }, // 39
  { wait: 400, points: 11 },
  { say: 'remove condom', points: 1 }, // 40
  { walk: [130, 146], within: 3 }, // the window, where the candy is
  { say: 'take candy', points: 2 }, // 41
  { walk: [126, 130], within: 3 }, // the sill
  { say: 'open window' }, // 42
  { say: 'climb out', enters: ROOM.alley }, // 43
  { walk: [53, 63], within: 1 }, // the head of the fire escape ladder
  { wait: 120 }, // down it, and into the trash bin
  { say: 'search dumpster' }, // 44
  { say: 'take hammer', points: 3 }, // 45
  { say: 'get out' }, // 46
  { wait: 40 },
];

/** The running total once Larry is out of the trash bin, hammer in hand. */
export const AFTER_THE_HOOKER = 67;

/**
 * Across town to the casino, by way of the man with the apples. Steps 47 to 53.
 *
 * Two men and only one of them is where the table implies. The trench coat at
 * step 52 is outside the wedding chapel, one screen east of the casino, and
 * the apple at step 53 is bought back outside the casino -- so the path goes
 * east, west, and the source's order of the two lines is the order it met
 * them in prose rather than a route.
 *
 * The apple is the only thing in the whole walk-through that has to be waited
 * for. Logic 32 rolls `random(1,3,52)` every time the room is entered and only
 * puts the man there on two of the three, and he then walks over, makes his
 * offer once, and wanders off again -- so "buy an apple" means going next door
 * and coming back until he is there to sell one. The apple matters: it is what
 * step 161 gives away for the last fifteen points of the game.
 */
export const TO_THE_CASINO: readonly Step[] = [
  { go: 'west', enters: ROOM.street }, // out of the alley, back to Lefty's
  { wait: 40 },
  ...cabTo('casino', ROOM.outsideCasino), // 47 to 51
  { go: 'east', enters: ROOM.outsideChapel },
  { wait: 60 },
  { say: 'talk man', points: 1 }, // 52
  {
    repeat: [
      { go: 'west', enters: ROOM.outsideCasino },
      { wait: 220 }, // long enough for him to walk over and make his offer
      { say: 'buy apple' }, // 53
      { go: 'east', enters: ROOM.outsideChapel },
      { wait: 40 },
    ],
    until: (larry) => larry.score === AFTER_TO_THE_CASINO,
    times: 10,
  },
  { go: 'west', enters: ROOM.outsideCasino },
  { wait: 60 },
];

/** The running total once Larry has an apple and the stranger's regards. */
export const AFTER_TO_THE_CASINO = 71;

/**
 * The casino. Steps 54 to 62.
 *
 * The table gives these as nine typed lines and no rooms at all, and they are
 * spread over four: the casino floor, the slot machines, the blackjack table,
 * and the lobby and its show room, which the source only reaches in prose.
 * Steps 58 to 61 are in the lobby, so the "get up" of step 62 is the one that
 * ends the show rather than the one that leaves the blackjack table -- Larry
 * has to stand up from the cards first, and the source does not say so.
 *
 * Everything here is a place to stand, and all of them are the rooms' own
 * boxes: the casino doors open by themselves from `posn(0,63,100,86,113)` and
 * are walked through by the top of the screen; the slots answer from
 * `posn(0,106,137,140,143)`, the near blackjack table from
 * `posn(0,18,133,47,154)`, and the ash tray with the pass card in it from
 * `posn(0,62,155,87,163)`.
 *
 * The one line the walk-through gives that must not be typed is the slot
 * machine's own suggestion to type "stop": in this game that word is `said(306)`
 * in logic 0, and logic 0 reads it as "quit". "Get up" leaves the machine.
 *
 * ### The money
 *
 * Nothing here pays points and all of it is necessary: the girl at the disco
 * wants $100 (`lessn(90,100)` in logic 25) and so does the wedding chapel, and
 * Larry arrives with $61. That is what the blackjack is for, and it is why
 * every source for this game says to save the game before each hand. So does
 * this: nine hands, each of them saved before and restored until it is won,
 * which is a walk-through step like any other and not a way of cheating -- the
 * cards are the game's own, and each restore deals new ones.
 */
/**
 * As much money as a byte will hold without the risk of wrapping.
 *
 * The wallet is var 90, so $255 is the ceiling, and a wallet that goes over it
 * wraps round to nothing. A hand that turns up blackjack pays three to two,
 * which is $30 on this table's $20 limit, so the last hand of a run can start
 * anywhere below this and still fit.
 */
const RICH = 200;

/**
 * "The money went up since this hand was dealt", as a test that remembers.
 *
 * A fresh one of these per hand: the first time it is asked -- which is before
 * the hand is played -- it notes what Larry has, and after that it says whether
 * he has more. Saying yes forgets again, so the same predicate can judge the
 * next hand.
 */
const wonAHand = () => {
  let before: number | null = null;
  return (larry: Playthrough): boolean => {
    const money = larry.machine.state.getVar(90);
    if (before === null) {
      before = money;
      return false;
    }
    if (money <= before) return false;
    before = null;
    return true;
  };
};

/** One winning hand: save, then play it over until it is won. */
const winAHand = (): Step[] => [
  { save: true },
  {
    repeat: [
      { restore: true },
      { press: 'F4' }, // deal, and take the bet
      { wait: 80 },
      { press: 'F8' }, // stand on what came
      { wait: 140 },
    ],
    until: wonAHand(),
    times: 40,
  },
];

/**
 * Sit at the blackjack table and play until Larry is as rich as a byte allows.
 *
 * The table has to have been sat down at and the bet set to $20 first. Nothing
 * in here is in the walk-through: the source says only "play blackjack", and
 * then assumes a player who saves before every hand -- so that is what this
 * does, and it stops as soon as there is enough rather than playing on.
 */
const untilRich: Step[] = [
  { repeat: winAHand(), until: (larry) => larry.machine.state.getVar(90) >= RICH, times: 25 },
  { wait: 200 }, // the last hand has to be paid out before the dealer lets go
];

/**
 * From the casino floor to the near blackjack table and back, richer.
 *
 * The path comes this way three times, because the fares go up as the night
 * goes on -- logic 10 charges `random(0,10)` plus a base it raises by a dollar
 * a ride, to a ceiling of $40 -- and $100 goes on the girl at the disco and
 * another $100 on the wedding. Only the first of the three is a walk-through
 * step; the other two are what the source means when it says money gates the
 * path.
 */
export const theBlackjackTable: Step[] = [
  { walk: [28, 146], within: 3 }, // the near table: `posn(0,18,133,47,154)`
  { say: 'play blackjack', enters: ROOM.blackjack },
  { wait: 60 },
  // A $10 hand first, because the third visit here is the one after Fawn has
  // taken the wallet and $10 is all there is: "you can't bet more than you
  // have" is what the table says to the walk-through's own $20.
  { say: 'change bet' },
  { say: '10' },
  { wait: 40 },
  ...winAHand(),
  { say: 'change bet' },
  { say: '20' },
  { wait: 40 },
  ...untilRich,
  // "Get up" is what F8 is bound to at this table, so it is read as standing
  // on the hand rather than leaving. Leaving is a line of its own.
  { say: 'leave table', enters: ROOM.casino },
  { wait: 40 },
];

/** In through the casino's automatic doors, from the forecourt outside. */
export const intoTheCasino: Step[] = [
  { walk: [74, 110], within: 3 }, // the doors open by themselves from here
  { wait: 60 },
  { go: 'north', enters: ROOM.casino }, // and are walked through by the top edge
  { wait: 40 },
];

export const THE_CASINO: readonly Step[] = [
  ...intoTheCasino,
  { walk: [112, 140], within: 3 }, // the slot machines
  { say: 'play slots', enters: ROOM.slots }, // 54
  { wait: 60 },
  { say: 'get up', enters: ROOM.casino },
  { wait: 40 },
  ...theBlackjackTable, // 55 to 57, and the nine hands the source does not list
  { go: 'north', enters: ROOM.lobby },
  { wait: 40 },
  { walk: [74, 159], within: 3 }, // the ash tray by the doors
  { say: 'look ashtray' }, // 58
  { say: 'take card', points: 1 }, // 59
  { say: 'look card' }, // 60
  // The show room is through a doorway two pixels wide -- `posn(0,131,101,132,106)`
  // -- so this is the one walk in the file that has to be exact.
  { walk: [131, 103], within: 0 },
  { wait: 80 },
  { walk: [107, 152], within: 3 }, // the one table that is not "Reserved"
  { say: 'sit', points: 1 }, // 61
  { wait: 60 },
  { say: 'get up' }, // 62
  { wait: 40 },
];

/** The running total once Larry has sat through the comic's act. */
export const AFTER_THE_CASINO = 73;

/**
 * Back to the store for the magazine, and two telephone calls. Steps 63 to 73.
 *
 * Reading the magazine shows its centrefold, which is an inventory close-up
 * rather than a message, and the point for step 70 is paid when it is pressed
 * past. Step 71 has to be said at the counter and not at the rack, and it is
 * not optional: walking out of the shop with something unpaid for starts the
 * clerk's shoplifting sequence, which ends the game in room 8.
 *
 * The number at step 73 is `209-6836858`, and the game does not know it. Logic
 * 22 holds six spellings of Sierra's own telephone number and compares what is
 * typed against all of them -- `(209) 683-6858`, `209 683-6858`, `2096836858`,
 * `209683-6858`, `209 6836858` -- and a hyphen after the area code is not one
 * of them. `2096836858` is, and it pays the five points the table wants.
 */
export const THE_MAGAZINE: readonly Step[] = [
  { go: 'south', enters: ROOM.lobby }, // out of the show room
  { wait: 40 },
  { go: 'south', enters: ROOM.casino },
  { wait: 40 },
  { go: 'south', enters: ROOM.outsideCasino },
  { wait: 40 },
  ...cabTo('store', ROOM.outsideStore), // 63 to 67
  { go: 'north', enters: ROOM.store },
  { wait: 40 },
  { walk: [65, 152], within: 3 }, // the magazine rack by the door
  { say: 'look magazines' }, // 68
  { say: 'take magazine', points: 1 }, // 69
  { say: 'read magazine', points: 1 }, // 70
  { walk: [30, 142], within: 2 }, // the counter: "buy" is only heard there
  { say: 'buy magazine' }, // 71
  { wait: 60 },
  { go: 'south', enters: ROOM.outsideStore },
  { wait: 40 },
  { walk: [60, 140], within: 4 },
  { say: 'use phone' }, // 72
  { say: '2096836858' }, // 73
  { wait: 120 },
];

/** The running total once Sierra's answering machine has been listened to. */
export const AFTER_THE_MAGAZINE = 80;

/**
 * The disco, and the girl who is what it is for. Steps 74 to 88.
 *
 * The disco is next door to the convenience store, which is why the table has
 * no taxi between steps 73 and 74. The bouncer wants the pass card from the
 * casino ash tray, and even once he has seen it the door has to be approached
 * afresh: logic 23 opens it from `posn(0,65,120,91,127)` and remembers that it
 * has opened, so the walk away and back is not decoration.
 *
 * The two seats at her table are `posn(0,112,121,123,124)` and the one beside
 * it, and only the first is the one she will let Larry take. Step 76 is a
 * `look` that the game answers with a complaint about Larry's breath, which is
 * why the breath spray -- step 36's line, used again here -- comes first; the
 * second look is the one that pays.
 *
 * ### The dance
 *
 * Steps 83 and 84 are the hardest thing in the walk-through to script, and
 * none of it is in the table. The dance floor is painted with the water
 * control colour and the dance does not start until Larry is standing on it,
 * flag 0 and all. While it runs, logic 24 puts ego `object.on.water`, so he
 * cannot leave the floor -- and the dancing view is three pixels wider than
 * the walking one, so a Larry who steps onto the floor at its edge is wider
 * than the water under him the moment the music starts and can never move
 * again. Hence the walk below the floor first: he goes on from the middle of
 * the bottom edge, where there is water to spare on either side.
 */
export const THE_DISCO: readonly Step[] = [
  { go: 'east', enters: ROOM.outsideDisco },
  { wait: 40 },
  { walk: [78, 124], within: 3 }, // in front of the bouncer
  { say: 'show card', points: 5 }, // 74
  { wait: 60 },
  { walk: [78, 145], within: 3 }, // away, so the door can open again
  { wait: 20 },
  { walk: [78, 124], within: 3 },
  { wait: 30 },
  { go: 'north', enters: ROOM.disco },
  { wait: 60 },
  { walk: [117, 122], within: 1 }, // her table, on the side she allows
  { say: 'sit', points: 1 }, // 75
  { wait: 120 },
  { say: 'use breath spray' }, // not in the table, and step 76 fails without it
  { wait: 60 },
  { say: 'look girl' }, // 76
  { wait: 40 },
  { say: 'look girl', points: 1 }, // 77
  { say: 'talk girl', points: 1 }, // 78
  { say: 'talk girl' }, // 79
  { say: 'give candy', points: 5 }, // 80
  { say: 'give rose', points: 5 }, // 81
  { say: 'give ring', points: 5 }, // 82
  { say: 'dance' }, // 83
  { wait: 80 },
  { say: 'get up' }, // 84
  { wait: 60 },
  { walk: [60, 132], within: 3 }, // below the dance floor
  { walk: [58, 118], within: 3 }, // and onto the middle of it
  { wait: 700, points: 5 }, // the dance itself, which is what pays
  { walk: [117, 122], within: 1 }, // back to her table
  { say: 'sit' }, // 85
  { wait: 120 },
  { say: 'look girl' }, // "she might listen, if you can establish eye contact"
  { wait: 60 },
  { say: 'talk girl' }, // 86
  { wait: 60 },
  { say: 'give money', points: 7 }, // 87
  { wait: 200 },
  { say: 'get up' }, // 88
  { wait: 40 },
];

/** The running total once she has agreed to meet Larry at the chapel. */
export const AFTER_THE_DISCO = 115;

/**
 * The wedding. Steps 89 to 95.
 *
 * The chapel is next door to the casino, which is why the taxi at steps 89 to
 * 93 asks for the casino and the table then says "open door" with no journey
 * in between.
 *
 * The detour through the blackjack table is not in the source and is not
 * optional: the minister wants $100 and Larry has about that much left after
 * the disco and the fare, with five more taxi rides still to come.
 *
 * The two places to stand are the chapel's own. The door opens from
 * `posn(0,80,115,105,120)`, and the vows are only taken from
 * `posn(0,61,114,94,130)` -- which the game explains as standing on the
 * bride's right.
 */
export const THE_WEDDING: readonly Step[] = [
  { go: 'south', enters: ROOM.outsideDisco },
  { wait: 40 },
  ...cabTo('casino', ROOM.outsideCasino), // 89 to 93
  ...intoTheCasino,
  ...theBlackjackTable,
  { go: 'south', enters: ROOM.outsideCasino },
  { wait: 40 },
  { go: 'east', enters: ROOM.outsideChapel },
  { wait: 60 },
  { walk: [92, 118], within: 3 }, // in front of the chapel door
  { say: 'open door', enters: ROOM.chapel }, // 94
  { wait: 120 },
  { walk: [78, 122], within: 3 }, // on the bride's right
  { say: 'get married' }, // 95
  { wait: 600, points: 12 }, // the minister has a great deal to say
];

/** The running total once Larry is a married man. */
export const AFTER_THE_WEDDING = 127;

/**
 * Up to the honeymoon suite, and out again. Steps 96 to 101.
 *
 * The chapel is beside the casino and the suite is upstairs in it, so there is
 * no taxi in this stretch either: out of the chapel, west to the casino, in
 * through the doors, up to the lobby, and into the lift -- which only answers
 * from `posn(0,70,110,83,120)`, standing in it.
 *
 * The fourth floor has several doors and only one of them is Fawn's: the
 * script wants `posn(0,6,126,15,135)`, at the far left of the landing.
 *
 * The point for step 98 is one point, not the five the source gives it. That
 * is the arithmetic slip `lsl1.md` records: every award up to here sums to
 * 127, the source's own running total after it is 128, and logic 41 pays
 * `addn(3, 1)` for the radio. The table is right about the total and wrong
 * about the award.
 */
export const THE_HONEYMOON_SUITE: readonly Step[] = [
  { go: 'south', enters: ROOM.outsideChapel },
  { wait: 40 },
  { go: 'west', enters: ROOM.outsideCasino },
  { wait: 40 },
  ...intoTheCasino,
  { go: 'north', enters: ROOM.lobby },
  { wait: 60 },
  { walk: [76, 115], within: 3 }, // inside the lift
  { say: 'press four' }, // 96
  { wait: 300 },
  { walk: [10, 130], within: 3 }, // the door at the end of the landing
  { say: 'knock door', enters: ROOM.honeymoonSuite }, // 97
  { wait: 200 },
  { walk: [55, 121], within: 3 }, // the radio: `posn(0,50,117,60,125)`
  { say: 'turn on radio', points: 1 }, // 98
  { wait: 120 },
  { say: 'talk fawn' }, // 99: "a little wine would help me get in the mood"
  { wait: 60 },
  // Back to the door the long way round, because Fawn stands between it and
  // the radio and a route planned straight through her gives up on her.
  { walk: [100, 135], within: 3 },
  { walk: [110, 137], within: 3 },
  { walk: [118, 134], within: 2 }, // the handle: `posn(0,116,129,125,136)`
  { say: 'open door', enters: ROOM.landing }, // 100
  { wait: 60 },
  { walk: [76, 126], within: 4 }, // back into the lift
  { say: 'press one' }, // 101
  { wait: 300 },
];

/** The running total once Larry is back in the casino lobby. */
export const AFTER_THE_HONEYMOON_SUITE = 128;

/**
 * The wine Fawn asked for, ordered from the pay phone. Steps 102 to 110.
 *
 * The number is the one the radio in the suite advertises, which is why step
 * 98 is worth its point: nothing else in the game says it.
 */
export const THE_WINE: readonly Step[] = [
  { go: 'south', enters: ROOM.casino },
  { wait: 40 },
  { go: 'south', enters: ROOM.outsideCasino },
  { wait: 40 },
  ...cabTo('store', ROOM.outsideStore), // 102 to 106
  { walk: [60, 140], within: 4 }, // the pay phone
  { say: 'use phone' }, // 107
  { say: '555-8039' }, // 108: Ajax Liquor
  { wait: 60 },
  { say: 'wine' }, // 109
  { wait: 60 },
  { say: 'honeymoon suite', points: 5 }, // 110
  { wait: 120 },
];

/** The running total once the wine is on its way to the suite. */
export const AFTER_THE_WINE = 133;

/**
 * The honeymoon, which is a mugging. Steps 111 to 124.
 *
 * The blackjack on the way up is again not in the source and again not
 * optional: the taxis have to be paid for, and what happens at the top of this
 * act is that Fawn ties Larry to the bed and leaves with his wallet. The game
 * leaves him $10 and says so -- "with your consummate gambling skills, you
 * should be back on your feet in no time" -- which is a hint that the source
 * turns into three more taxi fares without comment.
 *
 * Three places to stand, all the room's own: the wine bucket at
 * `posn(0,92,117,103,126)`, the bed at `posn(0,54,117,98,140)`, and the door
 * where the act ends.
 *
 * The pocket knife at step 121 is the drunk's, given for the wine outside the
 * store at step 25 -- the walk-through never says where it comes from, and
 * without it this is where the game ends.
 */
export const THE_HONEYMOON: readonly Step[] = [
  ...cabTo('casino', ROOM.outsideCasino), // 111 to 115
  ...intoTheCasino,
  ...theBlackjackTable,
  { go: 'north', enters: ROOM.lobby },
  { wait: 60 },
  { walk: [76, 115], within: 3 },
  { say: 'press four' }, // 116
  { wait: 300 },
  { walk: [10, 130], within: 3 },
  { say: 'knock door', enters: ROOM.honeymoonSuite }, // 117
  { wait: 200 },
  { say: 'talk fawn' }, // 118
  { wait: 60 },
  { walk: [97, 121], within: 3 }, // the wine bucket
  { say: 'pour wine' }, // 119
  { wait: 120 },
  { walk: [70, 133], within: 5 }, // the bed: anywhere in `posn(0,54,117,98,140)`
  { say: 'undress' }, // 120
  { wait: 900 }, // she ties him up and leaves with the wallet
  { say: 'use knife', points: 10 }, // 121
  { wait: 300 },
  { say: 'take rope', points: 3 }, // 122
  { wait: 60 },
  { walk: [100, 135], within: 3 },
  { walk: [110, 137], within: 3 },
  { walk: [118, 134], within: 2 },
  { say: 'open door', enters: ROOM.landing }, // 123
  { wait: 60 },
  { walk: [76, 126], within: 4 },
  { say: 'press one' }, // 124
  { wait: 300 },
];

/** The running total once Larry is loose, with a rope and ten dollars. */
export const AFTER_THE_HONEYMOON = 146;

/**
 * Back to Lefty's for the Spanish Fly. Steps 125 to 141.
 *
 * A third visit to the blackjack table opens this act, for the last two fares:
 * $10 does not cover one of them by now. Then the route the pimp's door and
 * the hooker's window opened at steps 31 to 43 is walked again, this time out
 * onto the fire escape with the rope from the honeymoon suite.
 *
 * The order the table gives for steps 134 to 136 cannot be played in that
 * order. Once the rope is tied to the railing and to Larry both, logic 12
 * calls `stop.motion(0)` on him for as long as he is on the fire escape -- so
 * the walk to its east end, `posn(0,82,60,99,64)`, has to happen before the
 * rope goes on rather than after it. Step 136 is the try the source records as
 * failing anyway: the window is locked until step 137 breaks it.
 *
 * Step 141 gets Larry out of the trash bin the fire escape ladder drops him
 * into, which is where step 46 left him too.
 */
export const THE_SPANISH_FLY: readonly Step[] = [
  { go: 'south', enters: ROOM.casino }, // out of the lobby, onto the floor
  { wait: 40 },
  ...theBlackjackTable,
  { go: 'south', enters: ROOM.outsideCasino },
  { wait: 40 },
  ...cabTo('bar', ROOM.street), // 125 to 129
  { say: 'open door', enters: ROOM.leftys }, // 130
  { wait: 40 },
  { say: 'knock door', expect: /rap loudly/i }, // 131
  { wait: 60 },
  { say: 'ken sent me', enters: ROOM.pimps }, // 132
  { wait: 60 },
  { go: 'north', enters: ROOM.bedroom }, // up the stairs, past the television
  { wait: 60 },
  { walk: [126, 130], within: 3 },
  { say: 'open window' }, // "it's already open" -- it was opened at step 42
  { wait: 40 },
  { say: 'climb out', enters: ROOM.alley }, // 133
  { wait: 80 },
  { walk: [85, 63], within: 2 }, // the east end, before the rope goes on
  { say: 'tie rope to balcony' }, // 134
  { wait: 60 },
  { say: 'tie rope to self' }, // 135
  { wait: 60 },
  { say: 'get pills' }, // 136: the window turns out to be locked
  { wait: 120 },
  { say: 'use hammer' }, // 137
  { wait: 200 },
  { say: 'get pills', points: 8 }, // 138
  { wait: 200 },
  { say: 'go balcony' }, // 139
  { wait: 200 },
  { say: 'untie rope' }, // 140
  { wait: 120 },
  { walk: [53, 63], within: 1 }, // the head of the ladder again
  { wait: 150 },
  { say: 'get out' }, // 141
  { wait: 100 },
];

/** The running total once Larry has the Spanish Fly. */
export const AFTER_THE_SPANISH_FLY = 154;

/**
 * The penthouse, and the inflatable doll. Steps 142 to 157.
 *
 * The lift in the casino lobby goes to the eighth floor now, and the penthouse
 * is behind the receptionist. Faith is dealt with by the Spanish Fly of step
 * 138, and the button that opens the private lift is only noticed once she has
 * gone -- which is what step 151 is for.
 *
 * The doll is the one place the source's order has to be taken literally and
 * the walking cannot be improvised. Logic 45 pops the doll the moment Larry
 * carries it uninflated past x 122, which is the closet doorway, so steps 155
 * and 156 both happen standing in the closet. Step 157 is typed twice: the
 * game asks "Geez, Larry. Do we have to?" the first time and only obliges on
 * being asked again -- "in fact, you've asked for it twice", as it says.
 */
export const THE_PENTHOUSE: readonly Step[] = [
  { go: 'west', enters: ROOM.street }, // out of the alley behind Lefty's
  { wait: 40 },
  ...cabTo('casino', ROOM.outsideCasino), // 142 to 146
  ...intoTheCasino,
  { go: 'north', enters: ROOM.lobby },
  { wait: 60 },
  { walk: [76, 115], within: 3 },
  { say: 'press eight' }, // 147
  // The lift counts the floors off one a second and only stops at the eighth,
  // which is the penthouse itself: there is no landing to walk out onto.
  { wait: 600 },
  { walk: [130, 146], within: 8 }, // Faith's desk: `posn(0,117,133,141,156)`
  { say: 'look girl' }, // 148
  { say: 'talk girl' }, // 149
  { say: 'give pills to faith', points: 5 }, // 150
  { wait: 400 },
  { say: 'look desk' }, // 151
  { say: 'push button' }, // 152
  { wait: 60 },
  { walk: [136, 126], within: 6 }, // and into the lift it opens, by the corner
  { walk: [142, 120], within: 6 },
  { walk: [147, 116], within: 1 }, // `posn(0,146,111,149,120)`, which is small
  { wait: 300, points: 5 },
  { walk: [113, 100], within: 0 }, // the bedroom door, two pixels wide again
  { wait: 200 },
  { walk: [112, 128], within: 3 }, // the closet handle
  { say: 'open door' }, // 153
  { wait: 60 },
  { walk: [125, 126], within: 1 }, // inside the closet, past the popping line
  { say: 'look closet' }, // 154
  { say: 'take doll', points: 5 }, // 155
  { wait: 60 },
  { say: 'inflate doll', points: 5 }, // 156
  { wait: 200 },
  { say: 'fuck doll' }, // 157: "Geez, Larry. Do we have to?"
  { wait: 200 },
  { say: 'fuck doll', points: 8 },
  { wait: 900 }, // the doll bursts, and takes Larry over the wall with it
];

/** The running total once the doll has burst and thrown Larry to the hot tub. */
export const AFTER_THE_PENTHOUSE = 182;

/**
 * Eve, in the hot tub. Steps 158 to 161, and the end of the game.
 *
 * The breath spray again, and again the source does not say so: the first look
 * at Eve is answered the way the first look at the girl in the disco was.
 *
 * The last row of the table is not a typed line at all -- it is the ending
 * playing itself out, and the twenty-five points it pays are the difference
 * between the 197 of step 161 and the 222 the source ends on.
 */
export const THE_END: readonly Step[] = [
  { say: 'use breath spray' },
  { wait: 60 },
  { say: 'look girl' }, // 158
  { wait: 60 },
  { say: 'undress' }, // 159
  { wait: 200 },
  { say: 'look girl' }, // 160
  { wait: 60 },
  { say: 'give apple', points: 15 }, // 161
  { wait: 900, points: 25 }, // and the game plays out its own ending
];

/** What the walk-through's own table ends on. */
export const AFTER_THE_END = 222;
