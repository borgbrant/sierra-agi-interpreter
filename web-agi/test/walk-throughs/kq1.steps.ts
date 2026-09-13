/**
 * `kq1.md` as engine input.
 *
 * The markdown beside this file is the walk-through: the room, the typed line
 * and the points it pays. This is the same path in the form a test can run,
 * and it supplies the three things the source says it does not have -- the AGI
 * room numbers, where in a room the player has to be standing, and the waits
 * that the source describes as prose.
 *
 * The numbers in the comments are the row of the table each step comes from.
 * Where the source is wrong the comment says so and plays what the game
 * actually wants.
 *
 * The coordinates are not guesses. Every one of them is a `posn` box read out
 * of the room's own logic, quoted in the comment beside it, because most of
 * the lines below are answered with "You are not close enough" from anywhere
 * else and the source records none of it.
 */
import type { Playthrough, Step } from '../helpers/playthrough.ts';

/**
 * Rooms the path visits, against the names the walk-through gives them.
 *
 * The outdoors is a six-by-eight grid of screens that wraps at every edge, so
 * "north" and "west" in the table below are moves on that grid and nothing
 * more. The interiors -- the castle, the two houses, the top of the oak --
 * are numbered well clear of it.
 */
export const ROOM = {
  outsideCastle: 1,
  castleDoor: 2,
  entranceHall: 55,
  greatHall: 54,
  throneRoom: 53,
  rock: 3,
  oakTree: 14,
  treeTop: 63,
  carrotPatch: 15,
  eastMeadow: 16,
  southMeadow: 9,
  cloverMeadow: 24,
  northMeadow: 25,
  westMeadow: 32,
  bowlMeadow: 31,
  lake: 18,
  riverBank: 34,
  walnutTree: 30,
  sorcerersWood: 29,
  mossyRock: 36,
  cottageSide: 45,
  gingerbreadHouse: 28,
  witchsHouse: 65,
  woodcutters: 44,
  northWood: 5,
  stump: 6,
  corral: 11,
  oakWood: 7,
  riverWood: 42,
  bridge: 39,
  gnome: 40,
  goatPen: 10,
  beanField: 38,
  beanstalkFoot: 70,
  beanstalkMiddle: 71,
  beanstalkTop: 72,
  cloudEdge: 56,
  cloudWood: 57,
  giant: 58,
  cloudTree: 62,
  cloudSouth: 61,
  cloudStairs: 59,
  stairsTop: 69,
  stairsUpper: 68,
  stairsLower: 67,
  stairsFoot: 66,
  lockedDoor: 19,
  mountainStream: 23,
  well: 12,
  wellShaft: 49,
  wellBottom: 52,
  dragonCave: 51,
  condorMeadow: 22,
  theFlight: 80,
  holeMeadow: 48,
  ragingRiver: 47,
  cavernMouth: 73,
  darkCavern: 74,
  ratCave: 75,
  antechamber: 76,
  treasury: 77,
  smallCave: 78,
  swamp: 37,
  blueLake: 43,
} as const;

/**
 * Variables and flags the path has to read to know what the game is doing.
 *
 * Three of the steps below are not "type this" but "wait until the game is
 * ready", and the only honest way to say that is in the game's own state.
 */
const STATE = {
  /** Logic 28: whose gingerbread house it is this visit. 1 is the witch at home. */
  witchIsIn: 81,
  /** Logic 65: counts down, twice over, to the witch coming home. Zero is "never". */
  witchComesHome: 30,
  /** Logic 65: set when the witch has walked all the way to her oven. */
  witchAtOven: 21,
  /** Logic 40: set once the gnome has asked the player to guess his name. */
  gnomeHasAsked: 22,
  /** Logic 11: set once the goat is following ego. */
  goatFollows: 75,
  /** Logic 58: what the giant is doing. 1 is asleep with the chest in his arms. */
  giantIs: 86,
  /** Logic 49: how Graham is in the well. 0 is on the rope, 1 and 2 are in the water. */
  swimming: 94,
  /** Logic 12: set while ego is hanging on the well rope rather than standing. */
  onTheRope: 180,
} as const;

const witchIsOut = (graham: Playthrough): boolean =>
  graham.machine.state.getVar(STATE.witchIsIn) === 2;

/**
 * Whether the elf is on screen.
 *
 * Logic 18 sets flag 20 when it draws him, but flag 20 is a scratch flag that
 * the rest of the game reuses for animations that have finished, so the elf
 * himself is the honest test: object 1, drawn.
 */
const elfIsOut = (graham: Playthrough): boolean => graham.machine.viewTable.at(1)?.drawn === true;

/** Whether the goat has taken the carrot and is following. */
const goatFollows = (graham: Playthrough): boolean => graham.machine.state.getFlag(STATE.goatFollows);

/**
 * From the first screen to the king. Steps 1 to 5.
 *
 * The doors are worth watching: `open door` is followed by `sound(15,28)` and
 * a script that waits for that sound to end before it moves the player inside.
 * A harness that runs cycles without letting time pass never hears the end of
 * it and the game stops there, which is why {@link Playthrough.run} ages the
 * sound by a cycle's worth of time.
 */
export const TO_THE_KING: readonly Step[] = [
  { go: 'west' }, // 1: west, onto the bridge
  { say: 'open door', points: 1 }, // 2: and the doors carry Graham inside
  { wait: 60 },
  { go: 'north' }, // 3: north, then west along the red carpet
  { go: 'west' },
  { say: 'bow to king', points: 3 }, // 4
  // The throne room answers anything said from outside `posn(0,60,85,86,113)`
  // with "It is proper to stand directly in front of ... King Edward", so the
  // walk-through's "talk to king" is a step about where to stand.
  { walk: [72, 100] },
  { say: 'talk to king' }, // 5
  { wait: 60 },
];

/** The walk-through's own running total once the king has been bowed to. */
export const AFTER_THE_KING = 4;

/**
 * Out of the castle and under the rock. Steps 6 to 9.
 *
 * The way out is not the way in. Logic 53 leaves the throne room by the right
 * edge only, logic 54 by the bottom, and logic 55 by the bottom again -- three
 * moves where the source says "west, out", which is the direction the player
 * feels rather than the one the keyboard gets.
 *
 * The rock is two `posn` boxes and only one of them is survivable. Moving it
 * from `posn(0,115,114,133,133)` rolls it clear; from `posn(0,118,134,133,148)`
 * -- the strip just below -- it rolls downhill over Graham. The corner they
 * share is also inside `posn(0,112,108,134,133)`, which is as close as the
 * dagger in the hole can be reached from, so one place to stand does both.
 */
export const TO_THE_DAGGER: readonly Step[] = [
  { go: 'east', enters: ROOM.greatHall }, // 6: out of the throne room
  { go: 'south', enters: ROOM.entranceHall },
  { go: 'south', enters: ROOM.castleDoor },
  { go: 'west', enters: ROOM.rock }, // 7: the screen with the rock on it
  { walk: [122, 122], within: 2 }, // uphill of the rock, not below it
  { say: 'push rock', points: 2 }, // 7
  { say: 'look in hole' }, // 8
  { say: 'get dagger', points: 5 }, // 9
];

/**
 * Up the oak, for the golden egg. Steps 10 to 13.
 *
 * `climb tree` is only answered from `posn(0,85,131,140,167)`, the foot of the
 * oak; from `posn(0,36,56,73,90)` the game says the tree is too hard to climb
 * and from anywhere else that there is no tree here.
 *
 * The top of the oak is its own room and pays two points for arriving. The
 * nest is object 1 at `70,85` and the egg wants `distance(0,1) < 24`, which is
 * a good deal closer than the branch Graham arrives on. What makes the climb
 * worth a step of its own is that stepping off the branch -- onto the water
 * control colour, which is what the sky is painted with up here -- drops him
 * to the ground. The route planner will not walk on water, so it stays on the
 * branch of its own accord.
 */
export const THE_GOLDEN_EGG: readonly Step[] = [
  { go: 'north', enters: ROOM.oakTree }, // 10: north one screen
  { walk: [110, 150], within: 6 }, // the foot of the oak
  { say: 'climb tree', points: 2, enters: ROOM.treeTop }, // 11
  { wait: 20 },
  // Where the nest can be reached from is not a `posn` box but a distance, and
  // the sky between is walkable as far as the control screen is concerned. What
  // is not walkable is the alarm colour painted over everything that is not the
  // branch: stepping on it anywhere outside `posn(0,12,106,57,166)` drops
  // Graham to the ground. So the planner is told to keep off it, and the climb
  // becomes the only way across.
  { signals: false },
  { walk: [70, 98], within: 6 },
  { say: 'get egg', points: 6 }, // 12
  { go: 'south', enters: ROOM.oakTree }, // 13: back down
  { signals: true },
];

/**
 * The carrot and the four-leaf clover. Steps 14 to 17.
 *
 * The carrot patch is five `posn` boxes stacked into a wedge, widest at the
 * bottom; `posn(0,46,92,159,116)` is the middle of them. Outside all five the
 * game says Graham must be in the patch to pick a carrot.
 *
 * The clover is object 1 at `53,134` and wants `distance(0,1) < 25`. The
 * three points the clover is worth are not the reason to have it -- it is the
 * charm that keeps the witch's house from being a death sentence, which is
 * nine steps away and which the source never connects to this one.
 */
export const THE_CARROT_AND_THE_CLOVER: readonly Step[] = [
  { go: 'east', enters: ROOM.carrotPatch }, // 14
  { walk: [100, 104], within: 4 }, // in the patch
  { say: 'pick carrot', points: 2 }, // 15
  { go: 'east', enters: ROOM.eastMeadow }, // 16: east twice, north once
  { go: 'east', enters: ROOM.southMeadow },
  { go: 'north', enters: ROOM.cloverMeadow },
  { walk: [55, 124], within: 4 }, // within reach of the clover patch
  { say: 'get clover', points: 2 }, // 17
];

/**
 * The bowl, the ring, the pebbles and the walnut. Steps 18 to 29.
 *
 * Four rooms and four boxes, all of them the rooms' own: the bowl only comes
 * up from `posn(0,116,128,136,148)`, the pebbles from `posn(0,68,83,109,124)`
 * and the walnut from `posn(0,9,112,98,167)`.
 *
 * The elf is the exception, and the one step the source is honest about being
 * vague. He is object 1, put down at `26,60` and left to wander his own
 * `block(100,95,139,100)`; `talk to elf` wants `distance(0,1) < 40` and pays
 * the ring on the spot. So the step is a wait for him to come round, and then
 * a walk to wherever he has got to -- which is why this one uses the harness's
 * own try-and-move-and-try-again rather than a coordinate.
 *
 * The walk-through gives steps 23 and 24 as "talk to elf" and then "get ring".
 * There is no second line: the elf hands over the ring when he is spoken to,
 * and the three points are paid there.
 */
export const THE_LAKE_AND_THE_RIVER: readonly Step[] = [
  { go: 'north', enters: ROOM.northMeadow }, // 18: north one, west two
  { go: 'west', enters: ROOM.westMeadow },
  { go: 'west', enters: ROOM.bowlMeadow },
  { walk: [126, 138], within: 4 }, // beside the bowl
  { say: 'get bowl', points: 3 }, // 19
  { say: 'look at bowl' }, // 20
  { go: 'south', enters: ROOM.lake }, // 21: south one, to the lake
  // 22: wait for the elf to appear, which is two dice rather than one. Logic
  // 18 rolls `random(0,250)` on every entry and puts the elf in the room only
  // on a throw under 85; then it counts a second roll, somewhere between 90
  // and 250, down to nothing before he walks into sight. So the wait is a
  // wait, and when it comes to nothing the answer is to leave and come back.
  {
    repeat: [
      { wait: 280 },
      // Nothing came of that roll; out of the room and back in for another.
      { go: 'north', enters: ROOM.bowlMeadow },
      { go: 'south', enters: ROOM.lake },
      { wait: 280 },
    ],
    until: elfIsOut,
    times: 10,
  },
  { wait: 40 },
  { walk: [44, 84], within: 8 }, // `distance(0,1) < 40` of the elf on the bank
  { say: 'talk to elf', points: 3 }, // 23 and 24: the ring comes with the words
  { go: 'north', enters: ROOM.bowlMeadow }, // 25: north twice, to the river
  { go: 'north', enters: ROOM.riverBank },
  { walk: [88, 100], within: 4 }, // on the delta, not in the current
  { say: 'get pebbles', points: 1 }, // 26
  { go: 'south', enters: ROOM.bowlMeadow }, // 27: south one, west one
  { go: 'west', enters: ROOM.walnutTree },
  { walk: [50, 140], within: 6 }, // under the walnut tree
  { say: 'get walnut', points: 3 }, // 28
  { say: 'open walnut', points: 3 }, // 29
];

/**
 * The gingerbread house and the witch in it. Steps 30 to 38.
 *
 * This is the part of the walk-through that is all timing, and the source says
 * so without saying what the timing is. Logic 28 rolls a die every time the
 * screen is entered: on one throw in two the witch is at home (`v81` = 1) and
 * walking through her door is walking into her arms, and on the other she is
 * out (`v81` = 2). "Leave and return until the game says Yum!" is that die,
 * and the loop below is the same thing said in a way a test can check.
 *
 * Inside, the same variable decides whether there is a witch to push at all.
 * With her out, logic 65 starts a two-stage countdown -- five hundred cycles
 * of it -- at the end of which she flies home, lands, and walks to her oven at
 * `26,120`. Only while she is standing there is `push witch` answered; before
 * she arrives and after the oven comes up to temperature she is hunting, and
 * the one safe corner is `posn(0,105,1,158,166)`, which is also the corner the
 * bedroom and the note are in. So the wait happens at the note, deliberately.
 *
 * Two corrections to the source. The table's `push witch into oven` is four
 * words and logic 65 tests `said(push, witch)`, which matches three; the extra
 * noun makes the line miss. And the cupboard is a cabinet: `open cupboard` and
 * `take cheese` are one line each, not the two the table asks for.
 */
/**
 * Waiting outside the gingerbread house for the witch to go out. Step 32.
 *
 * Logic 28 rolls a die every time the screen is entered and puts the answer in
 * `v81`: 1 is the witch at home, and walking through her door is walking into
 * her arms. "Leave and return until the game says Yum!" is that die, said in a
 * way a test can check.
 */
const WITCH_IS_OUT: Step = {
  repeat: [
    { go: 'east', enters: ROOM.sorcerersWood },
    { go: 'west', enters: ROOM.gingerbreadHouse },
  ],
  until: witchIsOut,
  times: 12,
};

/** The candy path and the door at the end of it. Step 33. */
const THROUGH_THE_DOOR: readonly Step[] = [
  { walk: [55, 131], within: 3 }, // `posn(0,40,127,70,135)`, the candy path
  { say: 'open door', enters: ROOM.witchsHouse },
  { wait: 40 },
];

/**
 * The gingerbread house and the witch in it. Steps 30 to 38.
 *
 * This is the part of the walk-through that is all timing, and the source says
 * so without saying what the timing is. There are three dice, not one.
 *
 * The first is {@link WITCH_IS_OUT}, on the way in. The second is inside: with
 * the witch out, logic 65 rolls again, and only on a throw under 180 does it
 * start the two-stage countdown that eventually brings her home. On the other
 * throw the house is simply empty, for ever, and there is nothing to push into
 * the oven -- so the answer is to walk out and walk back in, which re-rolls
 * both. That is the second loop below, and it reads `v30` because a countdown
 * that has not started is a countdown sitting at zero.
 *
 * The third is the countdown itself: five hundred cycles, at the end of which
 * she flies home, lands, and walks to her oven at `26,120`. Only while she is
 * standing there is `push witch` answered; before she arrives and after the
 * oven comes up to temperature she is hunting, and the one corner she does not
 * search is `posn(0,105,1,158,166)` -- which is also the corner the bedroom and
 * the note are in. So the waiting happens at the note, deliberately.
 *
 * Two corrections to the source. The table's `push witch into oven` is four
 * words and logic 65 tests `said(push, witch)`, which matches three; the extra
 * noun makes the line miss. And the cupboard is a cabinet: `open cupboard` and
 * `take cheese` are one line each, not the two the table asks for.
 */
export const THE_WITCH: readonly Step[] = [
  { go: 'west', enters: ROOM.sorcerersWood }, // 30: west twice, to the gingerbread house
  { go: 'west', enters: ROOM.gingerbreadHouse },
  WITCH_IS_OUT, // 32
  { walk: [60, 128], within: 4 }, // `posn(0,20,120,110,135)`, against the wall
  { say: 'eat house', points: 2 }, // 31
  ...THROUGH_THE_DOOR, // 33
  // Out and in again until the house is one the witch means to come back to.
  {
    repeat: [{ go: 'south', enters: ROOM.gingerbreadHouse }, WITCH_IS_OUT, ...THROUGH_THE_DOOR],
    until: (graham) => graham.machine.state.getVar(STATE.witchComesHome) > 0,
    times: 8,
  },
  { walk: [39, 96], within: 4 }, // `posn(0,23,89,55,100)`, under the cabinet
  { say: 'open cupboard', points: 2 }, // 37
  { say: 'take cheese', points: 2 }, // 38
  { walk: [127, 146], within: 4 }, // `posn(0,114,132,140,160)`, the bedside table
  { say: 'get note', points: 2 }, // 34
  { say: 'read note', points: 1 }, // 35
  // And now the countdown, spent standing in the one corner she does not search.
  {
    repeat: [{ wait: 60 }],
    until: (graham) => graham.machine.state.getFlag(STATE.witchAtOven),
    times: 16,
  },
  { walk: [33, 124], within: 2 }, // `distance(0,4) < 15` of the witch at her oven
  { say: 'push witch', points: 7 }, // 36
  { wait: 30 },
  // Out again, by `posn(0,39,164,56,166)` -- the only gap in the bottom wall.
  { go: 'south', enters: ROOM.gingerbreadHouse },
];

/** The running total once the witch is a blob and the cheese is in a pocket. */
export const AFTER_THE_WITCH = 52;

/**
 * The woodcutter's cottage, and the fiddle. Steps 39 to 43.
 *
 * The source's order looks wrong and is not. Giving the couple an empty bowl
 * is worth three points and gets a puzzled look; saying the word written on
 * the bottom of it -- `fill`, which step 20 read -- then fills it in front of
 * them, and *that* is what the fiddle is offered for. Filling the bowl before
 * giving it away scores the same three points and leaves the fiddle where it
 * is, because logic 79 only sets its flag on the version played out in the
 * room.
 *
 * The doorway is `posn(0,126,119,128,127)`: three pixels wide, and the whole
 * of the way in. The fiddle is `posn(0,120,140,158,166)`, the near corner of
 * the cottage floor.
 */
export const THE_FIDDLE: readonly Step[] = [
  // 39: the source says "north two", which is the way a player who has not
  // just come out of the witch's front door would go. Coming out of it, the
  // open door is an object standing in the middle of the garden path, and the
  // path is the only way to the top of the screen -- so this goes round the
  // outside instead: east, north twice, and west along the bottom.
  { walk: [60, 160], within: 6 }, // clear of the cookie fence first
  { go: 'east', enters: ROOM.sorcerersWood },
  { go: 'north', enters: ROOM.mossyRock },
  { go: 'north', enters: ROOM.cottageSide },
  { go: 'west', enters: ROOM.woodcutters },
  // 40: in. The doorway is `posn(0,126,119,128,127)` -- three pixels of it --
  // and standing there is the whole of the way into room 79.
  { walk: [127, 123], within: 1 },
  { wait: 40 },
  { say: 'give bowl', points: 3 }, // 41
  { say: 'fill bowl', points: 2 }, // 42
  { walk: [132, 152], within: 13 }, // anywhere in `posn(0,120,140,158,166)` reaches it
  { say: 'get fiddle', points: 3 }, // 43
];

/**
 * The stump, and what is buried in it. Steps 44 to 47.
 *
 * One box for all three lines, `posn(0,0,103,35,146)`, and the game's own
 * refusal from outside it is "I suggest you move closer to try that."
 *
 * The source says the pouch is worth three points to look into. It is worth
 * three to pick up and three to open -- `said(open, bag)` in logic 0 -- and
 * the line the table gives for it, "look in pouch", is the same test. The
 * total the source prints for this screen is right; the split is not.
 */
export const THE_POUCH: readonly Step[] = [
  // 44: out of the cottage, which is not an edge but a line: logic 79 watches
  // for ego on the alarm control colour, a stripe down the left wall at x=18,
  // and puts him back outside when he touches it.
  { go: 'west', enters: ROOM.woodcutters },
  { go: 'north', enters: ROOM.northWood }, // north one, west one
  { go: 'west', enters: ROOM.stump },
  { walk: [17, 125], within: 4 }, // beside the rotted stump
  { say: 'look in stump', points: 1 }, // 45
  { say: 'get pouch', points: 3 }, // 46
  { say: 'look in pouch', points: 3 }, // 47
];

/**
 * The goat. Steps 48 to 50.
 *
 * The goat is object 13, pacing his pen. Three things gate the carrot and the
 * source names none of them: the gate has to be opened from
 * `posn(0,6,139,55,167)`; ego has to walk through the gateway itself,
 * `posn(0,16,153,44,155)`, which is what sets the flag logic 11 reads as
 * "inside the pen"; and `show carrot` wants `distance(0,13) < 50`, which the
 * goat's own pacing keeps changing. So the last of them asks, waits, and asks
 * again.
 *
 * Inside the pen ego wears view 67 -- Graham and the goat side by side,
 * eighteen pixels wide against his usual six. Outside it the goat is object 13
 * again, following a pace behind. That difference decides the next act.
 */
export const THE_GOAT: readonly Step[] = [
  { go: 'north', enters: ROOM.corral }, // 48: north, to the corral
  { walk: [20, 160], within: 12 }, // `posn(0,6,139,55,167)`, within reach of the gate
  { say: 'open gate' }, // 49
  { wait: 20 },
  { walk: [30, 154], within: 1 }, // and through the gateway, which is only that wide
  // The pen is two screens wide and the goat wanders between them -- an open
  // gate is a way out for him as well -- so a round that does not find him
  // here goes next door and tries again there. Logic 10 keeps ego's height on
  // the way in while he is inside the pen, so this stays on the right side of
  // the fence.
  {
    repeat: [
      { walk: [45, 95], within: 8 },
      { say: 'show carrot to goat' },
      { wait: 20 },
      { go: 'west', enters: ROOM.goatPen },
      { walk: [100, 95], within: 14 },
      { say: 'show carrot to goat' },
      { wait: 20 },
      { go: 'east', enters: ROOM.corral },
    ],
    until: goatFollows,
    times: 4,
    points: 5, // 50
  },
  { wait: 40 },
];

/** The running total once the goat is following. */
export const AFTER_THE_GOAT = 72;

/**
 * The troll's bridge. Step 51.
 *
 * The source's "west one, south three" goes by the goat pen's other screen,
 * which is a cul-de-sac: it is the far half of the same pen, its own logic
 * says "the only way to get in is through the gate" and the gate is on the
 * screen behind, and its fence leaves gaps of about six pixels against the
 * eighteen ego is wide while the goat is beside him. South first and then west
 * reaches the same bridge with the same goat -- and outside the pen the goat
 * is object 13 again and ego is back to six pixels -- so that is the way this
 * goes.
 *
 * Two heights matter on the way. Logic 42 reads ego's x as he comes in from
 * the oak wood and, above 99, drops him in the middle of the river, which
 * drowns him; and it hands anyone arriving from the bridge below x=56 into a
 * closed pocket at the bottom left with no way out but the edge he came in by.
 *
 * The step itself is not a line but a place to stand: `posn(0,52,59,57,79)` is
 * the foot of the bridge, the troll comes out to block it, and the goat butts
 * him into the stream a few cycles later. The four points arrive with him.
 */
export const THE_BRIDGE: readonly Step[] = [
  { walk: [30, 155], within: 6 }, // 51: back out through the gateway
  { walk: [20, 162], within: 8 },
  { go: 'south', enters: ROOM.stump },
  { walk: [40, 120], within: 10 },
  { go: 'west', enters: ROOM.oakWood },
  { walk: [120, 60], within: 10 }, // in off the right edge, where the room puts him
  { walk: [60, 150], within: 10 }, // and down to the south edge at x <= 99
  { go: 'south', enters: ROOM.riverWood },
  { walk: [100, 90], within: 10 }, // the cliff path down the middle of the screen
  { walk: [112, 130], within: 10 },
  { walk: [110, 160], within: 10 }, // leaving at x > 74, clear of the pocket
  { go: 'south', enters: ROOM.bridge },
  { walk: [54, 70], within: 6 }, // `posn(0,52,59,57,79)`, the foot of the bridge
  { wait: 90, points: 4 }, // and the goat sees the troll off by himself
];

/** The running total once the troll is in the stream. */
export const AFTER_THE_BRIDGE = 76;

/**
 * The gnome, and his name. Steps 52 to 54.
 *
 * `ifnkovhgroghprm` is a word in `WORDS.TOK` -- *Rumpelstiltskin* with the
 * alphabet reversed, A for Z -- so it goes in at the prompt like any other
 * line, and the walk-through's worry about carrying an unknown token through
 * the parser does not arise. It is worth five points on the first guess, four
 * on the second and three on the third; this takes the first.
 */
export const THE_GNOME: readonly Step[] = [
  { go: 'west', enters: ROOM.gnome },
  // 52: the gnome paces his lean-to and `talk to gnome` wants
  // `distance(0,1) < 50`, so whether he hears depends on where his pacing has
  // got to. Ask, wait, ask again, until he has put the question.
  {
    repeat: [{ walk: [50, 118], within: 8 }, { say: 'talk to gnome' }, { wait: 30 }],
    until: (graham) => graham.machine.state.getFlag(STATE.gnomeHasAsked),
    times: 8,
  },
  { say: 'ifnkovhgroghprm', points: 5 }, // 53
  { wait: 40 },
  { say: 'get beans', points: 4 }, // 54
];

/** The running total once the beans are in Graham's pocket. */
export const AFTER_THE_GNOME = 85;

/**
 * Down the well, for the bucket and the water. Steps 65 to 73.
 *
 * The source plays this after the clouds and reaches it by swimming the ponds
 * west of the mountain. This path comes to it straight from the gnome, so the
 * ponds are never crossed: six screens south and east of the gnome's lean-to
 * is the same well, by way of the meadows the goat was led through. The order
 * is changed for the shield -- see {@link THE_GIANT} -- and changing it costs
 * nothing else, because nothing between here and the clouds needs anything the
 * clouds have.
 *
 * The well itself is four boxes and they are not the same box. `cut rope` is
 * answered from `posn(0,10,109,71,153)`, behind the well, and needs the
 * dagger; `lower rope` from `posn(0,60,108,77,129)`, which is the crank on the
 * far side; and getting onto the rope at all wants `posn(0,10,100,75,150)`.
 *
 * Then the rope is not walked but climbed, and a climb is the one thing the
 * route planner cannot plan: ego is on view 74 with `ignore.blocks`, and what
 * moves him is the direction key alone. Logic 12 reads his height off the rope
 * -- above 131 he is out, below 145 he is in the shaft -- and logic 49 the
 * same from the other end. So these are key presses counted out against the
 * room number, and not walks.
 *
 * The source's rows do not line up with what the game pays, though the totals
 * do. `lower rope` pays nothing; the point row 69 gives it is paid by logic 49
 * for arriving in the shaft, which is row 70. And row 71's `fill bucket` is a
 * line the game does know -- logic 101 answers it while swimming -- so it is
 * typed as written even though logic 49's own handler is `get water`.
 */
export const THE_WELL: readonly Step[] = [
  // 65: the source swims two ponds to get here from the foot of the mountain.
  // From the gnome the well is six screens the other way, and none of them is
  // water. The witch's flying screen, room 21, is the one to keep off, which
  // is why this goes round by the clover meadow rather than straight east.
  { go: 'south', enters: ROOM.northMeadow },
  { go: 'south', enters: ROOM.cloverMeadow },
  { go: 'east', enters: ROOM.mountainStream },
  { go: 'east', enters: ROOM.condorMeadow },
  { go: 'south', enters: ROOM.corral },
  { go: 'east', enters: ROOM.well },
  { walk: [30, 140], within: 10 }, // 66: `posn(0,10,109,71,153)`, behind the well
  { say: 'cut rope', points: 2 }, // 67
  { walk: [68, 120], within: 4 }, // 68: `posn(0,60,108,77,129)`, the crank
  { say: 'lower rope' }, // 69: which the game pays nothing for
  // 70: onto the rope from `posn(0,10,100,75,150)`, and then down it. The
  // point the source gives row 69 is paid here, by logic 49, for arriving.
  { walk: [40, 140], within: 10 },
  { say: 'climb rope' },
  {
    repeat: [{ press: 'Numpad2' }, { wait: 2 }],
    until: (graham) => graham.room === ROOM.wellShaft,
    times: 40,
    points: 1,
  },
  // And on down the shaft, until the water at the bottom takes him: `v94` is
  // 1 while he is swimming in it and 0 while he is still on the rope.
  {
    repeat: [{ press: 'Numpad2' }, { wait: 2 }],
    until: (graham) => graham.machine.state.getVar(STATE.swimming) === 1,
    times: 100,
  },
  { say: 'fill bucket', points: 2 }, // 71
  { say: 'dive', points: 2 }, // 72
  // 73: the way through to the dragon is `posn(0,31,111,32,130)`, two pixels
  // of it, and walking in leaves the room -- a failed walk and a finished step
  // at once, so the question asked is which room ego is in. The point the
  // source gives this row is logic 51's, for arriving in the cave.
  {
    repeat: [{ walk: [31, 120], within: 0 }],
    until: (graham) => graham.room === ROOM.dragonCave,
    times: 4,
    points: 1,
  },
  { wait: 10 },
];

/**
 * The dragon, the water and the magic mirror. Steps 74 to 77.
 *
 * Both lines are about where Graham is standing, and the two boxes do not
 * overlap. The dragon is only doused from *outside* `posn(0,105,96,145,166)`,
 * which is the corner ego arrives in, so the first thing to do is walk out of
 * it; and the mirror is only picked up from *inside* `posn(0,26,104,59,127)`,
 * which is the far side of the cave.
 *
 * Throwing the water spends it -- logic 51 takes back the two points it was
 * worth and pays seven for the dragon, which is the five the source's row 74
 * gives. Walking back into the well fills the bucket again, and pays the two
 * back a second time along with two for the return, which is where rows 76 and
 * 77 get their four. `climb rope` itself pays nothing.
 */
export const THE_DRAGON: readonly Step[] = [
  { walk: [90, 145], within: 8 }, // clear of `posn(0,105,96,145,166)`
  { say: 'throw water', points: 5 }, // 74
  { walk: [42, 115], within: 6 }, // `posn(0,26,104,59,127)`, within reach
  { say: 'get mirror', points: 8 }, // 75
  { go: 'east', enters: ROOM.wellBottom, points: 4 }, // 76: and the bucket refills
  { go: 'north', enters: ROOM.wellShaft },
  { say: 'climb rope' }, // 77
  {
    repeat: [{ press: 'Numpad8' }, { wait: 2 }],
    until: (graham) => graham.room === ROOM.well,
    times: 200,
  },
  { wait: 10 },
  // Arriving at the top is still being on the rope, and logic 12 drops anyone
  // whose x leaves the span of it. So he is climbed off it before he is walked
  // anywhere: flag 180 is the game's own word for "on the rope".
  {
    repeat: [{ press: 'Numpad8' }, { wait: 2 }],
    until: (graham) => !graham.machine.state.getFlag(STATE.onTheRope),
    times: 60,
  },
  { wait: 10 },
];

/**
 * The condor. Steps 78 and 79.
 *
 * "Stand at bottom centre and let the bird take you" is two things the source
 * does not say. The bird has to be jumped at -- logic 22 wants flag 143, which
 * is what `said(jump)` sets -- and the jump only counts from between twenty
 * and thirty-five away from it with ego well below. The bird `wander`s, and is
 * turned back north whenever it falls below y=115, so the place to jump from
 * moves: it is reached by steering rather than by walking to a spot, which is
 * what {@link Playthrough.stalk} is for.
 *
 * What it carries him to is the far north-west corner of the map, which is the
 * only way over the Raging River.
 */
export const THE_CONDOR: readonly Step[] = [
  { go: 'west', enters: ROOM.corral }, // 78: west one, north one
  { go: 'north', enters: ROOM.condorMeadow },
  // 79: close to the bird, jump, and if it has drifted, close and jump again.
  {
    repeat: [{ stalk: 1, gap: [21, 34], below: 21, cycles: 300 }, { say: 'jump' }],
    until: (graham) => graham.room === ROOM.theFlight,
    times: 6,
    points: 3,
  },
  // The flight is a scripted one and ends where it ends; the meadow with the
  // hole in it is on the other side of the river.
  {
    repeat: [{ wait: 20 }],
    until: (graham) => graham.room === ROOM.holeMeadow,
    times: 20,
  },
  { wait: 20 },
];

/**
 * The mushroom, and the hole under the meadow. Steps 80 to 82.
 *
 * `get mushroom` is answered from `posn(0,74,70,94,90)` and nowhere else.
 *
 * The hole back east is painted with the water control colour, which is how
 * logic 48 knows Graham has walked into it -- flag 0, ego on water. So the
 * planner has to be let onto water for the one step that falls in, the same
 * `{ swims }` the source's own crossing of the ponds would have wanted.
 */
export const THE_MUSHROOM: readonly Step[] = [
  { go: 'west', enters: ROOM.ragingRiver }, // 80
  { walk: [84, 80], within: 6 }, // `posn(0,74,70,94,90)`
  { say: 'get mushroom', points: 1 }, // 81
  { go: 'east', enters: ROOM.holeMeadow }, // 82: east, and then in
  { swims: true },
  {
    repeat: [{ walk: [78, 122], within: 0 }],
    until: (graham) => graham.room === ROOM.cavernMouth,
    times: 4,
  },
  { swims: false },
  { wait: 40 },
];

/**
 * The rat, and the door it is sitting in front of. Steps 82 to 85.
 *
 * The rat is `follow.ego` and kills on arrival, and the cheese is only taken
 * from between sixteen and thirty-four away -- so the whole of this step is
 * the gap between those two numbers. Walking to a spot cannot hold it, because
 * the rat is walking too; {@link Playthrough.stalk} steers until the gap is
 * right and stops there, which is the same thing the condor needed.
 *
 * The approach has to be staged first. The cave's near half is walled off from
 * the rat's at ego's own height, and a planner asked to go straight at him
 * walks into the wall and stands there while he comes.
 *
 * `open door` is a distance too -- logic 75 wants `distance(0,2) < 25` of the
 * door at `25,119` -- and opening it walks Graham through.
 */
export const THE_RAT: readonly Step[] = [
  { go: 'south', enters: ROOM.darkCavern }, // 82: south, and west
  { go: 'west', enters: ROOM.ratCave },
  { walk: [110, 122], within: 6 }, // round the wall, before closing on him
  { stalk: 1, gap: [16, 34], cycles: 300 },
  { say: 'give cheese to rat', points: 2 }, // 83
  { stalk: 2, gap: [0, 20], cycles: 200 }, // 84: `distance(0,2) < 25` of the door
  { say: 'open door' },
  { wait: 30 },
  { say: 'play fiddle', points: 3 }, // 85: and the leprechauns dance away
  { wait: 60 },
];

/**
 * The treasury, and the way out of it. Steps 86 to 91.
 *
 * The shield and the sceptre are two boxes that overlap: `posn(0,121,118,
 * 144,138)` for the shield and `posn(0,103,100,142,142)` for the sceptre, and
 * one place to stand does both. The shield is the point of the whole detour --
 * it sets flag 102, which is what makes the giant harmless.
 *
 * The way out is the small hole, and it is behind a wall Graham cannot pass at
 * his own size: `eat mushroom` shrinks him and the wall has a gap a mouse can
 * take. One bite is enough, where the source says two. The shrinking does not
 * last -- logic 78 kills anyone still in the hole when it wears off -- so the
 * hole is left by a screen edge and not by a walk, which is the quickest way
 * the harness has of getting to one.
 */
export const THE_TREASURY: readonly Step[] = [
  { go: 'south', enters: ROOM.treasury }, // 86
  { wait: 30 },
  { walk: [132, 128], within: 6 }, // inside both boxes at once
  { say: 'get shield', points: 8 }, // 87
  { say: 'get sceptre', points: 6 }, // 88
  { go: 'west', enters: ROOM.smallCave }, // 89: west, and up the stairs
  { wait: 30 },
  { walk: [8, 80], within: 8 }, // as far up them as a full-sized Graham goes
  { say: 'eat mushroom', points: 2 }, // 90: once, not the twice the source says
  { go: 'west', enters: ROOM.mossyRock, points: 1 }, // 91: and out through the hole
  { wait: 40 },
];

/** The running total once Graham is back above ground with the shield. */
export const AFTER_THE_TREASURY = 136;

/**
 * The beanstalk, and the land of the clouds. Steps 55 to 60.
 *
 * `plant beans` works anywhere on the flower screen; `climb beanstalk` only
 * from `posn(0,52,76,103,97)`, the foot of it, and what it does is not a room
 * change but a hoist -- logic 38 puts ego on view 74, sets flag 157 and moves
 * him up the stalk, and the screen above is reached by walking off the top
 * edge afterwards.
 *
 * The sling is in a hollow tree and comes out from `posn(0,117,100,144,117)`.
 * Walking the clouds themselves is fatal, which is what keeps the routes on
 * this act honest: the walkable strips are painted as ordinary ground and the
 * clouds are not, so the planner stays on the path without being told.
 */
export const THE_BEANSTALK: readonly Step[] = [
  // 55: the flower meadow is two screens east of the gnome, where the source's
  // order would have arrived from, and four from the mossy rock the underworld
  // lets Graham out at. Not the two it looks like: the screen directly west of
  // the rock is a swamp, walkable only round its rim, with no way across from
  // the side he comes in on. So this goes round the north of it, by the
  // woodcutters' cottage and the blue lake.
  { go: 'north', enters: ROOM.cottageSide },
  { go: 'west', enters: ROOM.woodcutters },
  { go: 'west', enters: ROOM.blueLake },
  { go: 'south', enters: ROOM.beanField },
  { say: 'plant beans', points: 2 }, // 56
  { walk: [70, 88], within: 8 }, // `posn(0,52,76,103,97)`, the foot of the stalk
  { signals: false }, // off the stalk is the alarm colour, and a long way down
  { say: 'climb beanstalk' }, // 57
  { wait: 60 },
  { go: 'north', enters: ROOM.beanstalkFoot }, // 58: up, and then east twice
  { go: 'north', enters: ROOM.beanstalkMiddle },
  { go: 'north', enters: ROOM.beanstalkTop },
  // Getting off the stalk is a step onto the signal line, not off it: logic 72
  // reads ego touching one inside `posn(0,65,100,82,120)` as stepping onto the
  // cloud, and touching one anywhere else as losing his grip. The line across
  // the rungs at y=118 and y=108 are inside it, so the planner is let back
  // onto signals for the one step that crosses the lower of them.
  { walk: [70, 119], within: 1 },
  { signals: true },
  // The rung is crossed, not walked along: logic 72 answers it by putting ego
  // off the stalk at 85,112, which is where this walk ends up.
  { walk: [85, 112], within: 8 },
  { wait: 40 },
  // And off again straight away: on the cloud screens the same colour is what
  // the clouds themselves are painted with, and stepping on one is a long way
  // down. Every route from here to the sling keeps to the ground.
  { signals: false },
  { go: 'east', enters: ROOM.cloudEdge },
  { go: 'east', enters: ROOM.cloudWood },
  { go: 'east', enters: ROOM.giant }, // south, and east once more
  { go: 'south', enters: ROOM.cloudSouth },
  { go: 'east', enters: ROOM.cloudTree },
  { walk: [128, 110], within: 8 }, // `posn(0,117,100,144,117)`, beside the hollow
  { say: 'look in hole' }, // 59
  { say: 'get sling', points: 2 }, // 60
];

/** The running total once the sling is in a pocket. */
export const AFTER_THE_SLING = 140;

/**
 * The giant, and the magic chest. Steps 61 to 63.
 *
 * The source says to stand behind a tree until the giant falls asleep. There
 * is no tree to stand behind: logic 58's screen is open cloud with a few
 * one-pixel trunks on it, and the giant is `follow.ego` at ego's own speed,
 * which in a closed room catches anybody -- a rollout of the chase says inside
 * ninety cycles, whatever the player does, and the game wants seven hundred
 * and fifty of them before he nods off.
 *
 * What logic 58 actually asks for is one of three protections: the magic
 * shield, the fairy godmother's spell, or the ring. Any of them turns the
 * giant from `follow.ego` into `wander`, and then the wait is only a wait.
 * This path has the shield, which is why the underworld is played before the
 * clouds and not after: the spell lasts two thousand five hundred cycles,
 * which is not enough to cross the map, and the ring is spent when it is used
 * -- logic 0 takes back its three points when the spell runs out, and logic 52
 * takes them at the bottom of the well whether the spell has run out or not.
 * The shield is the only one of the three that is still there afterwards.
 */
export const THE_GIANT: readonly Step[] = [
  { go: 'west', enters: ROOM.cloudSouth }, // 61: back west and north, to the giant
  { go: 'north', enters: ROOM.giant },
  // 62: and now the wait, seven hundred and fifty cycles of it. `v86` is the
  // giant: 0 awake with the chest, 1 asleep with it, 2 and 3 without.
  {
    repeat: [{ wait: 60 }],
    until: (graham) => graham.machine.state.getVar(STATE.giantIs) === 1,
    times: 20,
    points: 7,
  },
  { say: 'get chest', points: 8 }, // 63
];

/** The running total once the chest is out of the sleeping giant's arms. */
export const AFTER_THE_GIANT = 155;

/**
 * Down the mountain. Step 64.
 *
 * The way off the clouds is a staircase inside the mountain, and every door of
 * it is a `posn` box rather than a screen edge: `posn(0,135,94,136,120)` two
 * pixels wide is the mouth of the cave, `posn(0,138,156,155,157)` is the head
 * of the stairs, and `posn(0,16,165,31,166)` at the bottom is the way out into
 * the daylight again.
 *
 * Row 65, the two ponds west of here, is not played: in this order the well
 * they lead to has been and gone, and the road home runs the other way. Which
 * is the one thing the reordering costs. Graham never swims on this path --
 * the one `{ swims }` in it is {@link THE_MUSHROOM}'s, for a hole that is
 * painted with the water colour and is not water.
 */
export const DOWN_THE_MOUNTAIN: readonly Step[] = [
  { go: 'east', enters: ROOM.cloudStairs }, // 64: east, and then down
  // Each of these is a doorway rather than an edge, so walking into it ends
  // the walk by leaving the room -- which is a failed walk and a finished step
  // at the same time. Hence the loops: the question is which room ego is in.
  {
    repeat: [{ walk: [136, 107], within: 0 }],
    until: (graham) => graham.room === ROOM.stairsTop,
    times: 3,
  },
  { wait: 30 },
  {
    repeat: [{ walk: [146, 157], within: 1 }],
    until: (graham) => graham.room === ROOM.stairsUpper,
    times: 3,
  },
  { wait: 30 },
  { go: 'south', enters: ROOM.stairsLower },
  // `posn(0,5,150,6,167)` -- the foot of this flight is two pixels wide too.
  {
    repeat: [{ walk: [5, 160], within: 1 }],
    until: (graham) => graham.room === ROOM.stairsFoot,
    times: 3,
  },
  { wait: 30 },
  {
    repeat: [{ walk: [23, 166], within: 1 }],
    until: (graham) => graham.room === ROOM.lockedDoor,
    times: 3,
  },
  { wait: 30 },
];

/**
 * Home to the castle, and the end of it. Steps 92 to 94.
 *
 * The source's "north twice, east twice" is the walk home from the mossy rock
 * the underworld lets you out at, which in this order was two acts ago. From
 * the foot of the mountain the same castle is three screens the other way.
 *
 * The last two rows are the first two over again: logic 53 wants Graham inside
 * `posn(0,60,85,86,113)` before it will hear him, and `bow to king` pays the
 * same three it paid on the way out.
 */
export const THE_WAY_HOME: readonly Step[] = [
  { go: 'south', enters: ROOM.oakTree }, // 92: south one, east one, south one
  { go: 'east', enters: ROOM.carrotPatch },
  { go: 'south', enters: ROOM.castleDoor },
  { say: 'open door', points: 1 },
  { wait: 60 },
  { go: 'north', enters: ROOM.greatHall }, // 93: north, and west to the king
  { go: 'west', enters: ROOM.throneRoom },
  { walk: [72, 100] }, // `posn(0,60,85,86,113)`, in front of the throne
  { say: 'bow to king', points: 3 }, // 94
  { wait: 60 },
];

/**
 * The whole path this file plays, in the order the game will take it.
 *
 * Every row of the table, and every kind of step King's Quest has: a room
 * entered over and over until a die falls the right way, a character who has
 * to be waited five hundred cycles for, an inventory puzzle whose answer is
 * written on the bottom of an inventory item, a follower led four screens
 * across the map, a password, a beanstalk, a giant, a rope to climb, two
 * wandering creatures to close on without touching, and a giant condor.
 *
 * The order is the source's own except for one move: rows 65 to 91, the well
 * and the underworld, are played before rows 55 to 64, the beanstalk and the
 * clouds, rather than after. The reason is the magic shield in the treasury,
 * which is the only one of the giant's three protections that survives being
 * used -- {@link THE_GIANT} says why. Nothing else in the path depends on the
 * order, and the walk-through's own directions for rows 65 and 92 are the two
 * casualties: both are walks between screens, and both are replaced with the
 * walk between the screens this order actually joins.
 */
export const THE_PATH: readonly Step[] = [
  ...TO_THE_KING,
  ...TO_THE_DAGGER,
  ...THE_GOLDEN_EGG,
  ...THE_CARROT_AND_THE_CLOVER,
  ...THE_LAKE_AND_THE_RIVER,
  ...THE_WITCH,
  ...THE_FIDDLE,
  ...THE_POUCH,
  ...THE_GOAT,
  ...THE_BRIDGE,
  ...THE_GNOME,
  ...THE_WELL,
  ...THE_DRAGON,
  ...THE_CONDOR,
  ...THE_MUSHROOM,
  ...THE_RAT,
  ...THE_TREASURY,
  ...THE_BEANSTALK,
  ...THE_GIANT,
  ...DOWN_THE_MOUNTAIN,
  ...THE_WAY_HOME,
];

/**
 * What the game's own scoring adds up to at the end of it.
 *
 * One more than the hundred and fifty-eight logic 0 puts in `v7` and calls the
 * maximum, and the source's table adds to the same hundred and fifty-nine: the
 * two agree row for row, and it is the game's stated total that is short.
 * Logic 2 pays a point for opening the castle door and another for opening it
 * a second time -- flag 193 and then flag 206 -- and coming home to the king
 * means opening it a second time. There is no way in but through it: nothing
 * else in the room admits anybody, and the doors do not open for the returning
 * hero on their own.
 */
export const REACHED = 159;

/** What logic 0 calls the maximum, which is one less than the path pays. */
export const MAXIMUM = 158;
