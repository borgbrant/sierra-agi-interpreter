# King's Quest I — walk-through, as engine input

A distilled step list for driving the engine through a full game, and for
judging whether it got there. Not prose: what is kept is the parser input, the
movement, the room it happens in and the score it pays.

```text
source      https://www.sierragamers.com/kq1-agi-text-walkthrough/
retrieved   2026-09-07
covers      one solution path, no alternate endings
game        the AGI release, which is the 2.917 copy in agi-extract/data/kq1
```

Only the facts of the game are recorded here -- commands, rooms, points. The
article's own text is not reproduced; read it at the link above.

## How to read the table

```text
#          order. The path is linear: a step assumes every step before it
where      the room as the walk-through names it, not an AGI room number --
           those are not in the source and are not guessed at here
input      what the player does. Two kinds, and the difference matters:
             `said(...)`  a line typed at the prompt and parsed
             move / act   direction keys, or waiting, or standing somewhere
pts        score the step pays, from the source
```

## Checked against the game's own vocabulary

Every typed word below was looked up in King's Quest's `WORDS.TOK` before it was
written down, which is worth doing once rather than debugging a test later.

```text
verbs present    open bow talk push look get climb pick eat read enter give
                 fill show guess plant throw jump play cut lower dive swim take
verbs absent     wait, cross, hide
nouns present    all of them, except as below
nouns absent     crank
spelling         the game knows `sceptre`, not `scepter`
```

The absences are the useful part: `wait`, `cross`, `hide` and `crank` are things
the source describes as actions and the player never types. They are marked as
`move`/`act` in the table for exactly that reason -- a test that types them will
get a parser miss, not a step.

## The path

| #  | where | input | pts |
|----|-------|-------|-----|
| 1  | outside castle | move: west, onto the bridge | |
| 2  | castle door | `said(open door)` | 1 |
| 3  | inside castle | move: north, then west along the red carpet | |
| 4  | throne room | `said(bow to king)` | 3 |
| 5  | throne room | `said(talk to king)` | |
| 6  | throne room | move: west, out | |
| 7  | rock | `said(push rock)` | 2 |
| 8  | rock | `said(look in hole)` | |
| 9  | rock | `said(get dagger)` | 5 |
| 10 | big tree | move: north one screen | |
| 11 | big tree | `said(climb tree)` | 2 |
| 12 | big tree | `said(get egg)` | 6 |
| 13 | big tree | act: climb or fall down | |
| 14 | carrot field | move: east | |
| 15 | carrot field | `said(pick carrot)` | 2 |
| 16 | clover field | move: east twice, north once | |
| 17 | clover field | `said(get clover)` | 2 |
| 18 | bowl | move: north one, west two | |
| 19 | bowl | `said(get bowl)` | 3 |
| 20 | bowl | `said(look at bowl)` | |
| 21 | elf | move: south one | |
| 22 | elf | act: wait for the elf to appear | |
| 23 | elf | `said(talk to elf)` | |
| 24 | elf | `said(get ring)` | 3 |
| 25 | beach | move: north twice | |
| 26 | beach | `said(get pebbles)` | 1 |
| 27 | walnut tree | move: south one, west one | |
| 28 | walnut tree | `said(get walnut)` | 3 |
| 29 | walnut tree | `said(open walnut)` | 3 |
| 30 | witch's house | move: there, avoiding the wizard | |
| 31 | witch's house | `said(eat house)` | 2 |
| 32 | witch's house | act: leave and return until the game says "Yum!" | |
| 33 | witch's house | `said(open door)`, then enter | |
| 34 | witch's bedroom | `said(get note)` | 2 |
| 35 | witch's bedroom | `said(read note)` | 1 |
| 36 | witch's house | `said(push witch into oven)` | 7 |
| 37 | witch's house | `said(open cupboard)` twice | |
| 38 | witch's house | `said(take cheese)` twice | 4 |
| 39 | house | move: out, north two | |
| 40 | house | act: enter | |
| 41 | house | `said(give bowl)` | 3 |
| 42 | house | `said(fill bowl)` | 2 |
| 43 | house | `said(get fiddle)` | 3 |
| 44 | stump | move: out, north one, west one | |
| 45 | stump | `said(look in stump)` | 1 |
| 46 | stump | `said(get pouch)` | 3 |
| 47 | stump | `said(look in pouch)` | 3 |
| 48 | corral | move: north | |
| 49 | corral | `said(open gate)` | |
| 50 | corral | `said(show carrot to goat)` | 5 |
| 51 | bridge | move: west one, south three; the goat follows and sees off the troll | 4 |
| 52 | gnome | `said(talk to gnome)` | |
| 53 | gnome | `said(IFNKOVHGROGHPRM)` — see *The gnome's name* | 5 |
| 54 | gnome | act: receive the beans | 4 |
| 55 | beanstalk | move: east twice | |
| 56 | beanstalk | `said(plant beans)`, by the flowers | 2 |
| 57 | beanstalk | `said(climb beanstalk)` — save first | |
| 58 | clouds | move: east twice, south, east twice | |
| 59 | clouds | `said(look in hole)` | |
| 60 | clouds | `said(get sling)` | 2 |
| 61 | giant | move: west twice, north; stand in the north-east corner — save | |
| 62 | giant | move: east, then act: stay behind the tree until the giant sleeps | 7 |
| 63 | giant | `said(get chest)` | 8 |
| 64 | stairs | move: east twice, then down | |
| 65 | pond | move: west twice, swimming; then south one | |
| 66 | well | act: stand behind the well | |
| 67 | well | `said(cut rope)` | 2 |
| 68 | well | act: walk to the crank | |
| 69 | well | `said(lower rope)` | 1 |
| 70 | well | act: climb, then move down | |
| 71 | well | `said(fill bucket)`, swimming | 2 |
| 72 | well | `said(dive)` | 2 |
| 73 | well | move: down and left, then `said(go through hole)` | 1 |
| 74 | dragon | `said(throw water)` | 5 |
| 75 | dragon | `said(get mirror)` | 8 |
| 76 | well | act: swim up | |
| 77 | well | `said(climb rope)` | 4 |
| 78 | bird | move: west one, north one | |
| 79 | bird | act: stand at bottom centre and let the bird take you | 3 |
| 80 | mushroom | move: west | |
| 81 | mushroom | `said(get mushroom)` | 1 |
| 82 | rat | move: east, fall in the hole, then south and west | |
| 83 | rat | `said(give cheese to rat)` | 2 |
| 84 | rat | `said(open door)` | |
| 85 | rat | `said(play fiddle)` | 3 |
| 86 | treasury | move: south | |
| 87 | treasury | `said(get shield)` | 8 |
| 88 | treasury | `said(get sceptre)` | 6 |
| 89 | small door | move: west, up the stairs | |
| 90 | small door | `said(eat mushroom)` twice | 2 |
| 91 | small door | `said(go through hole)` | 1 |
| 92 | final castle | move: north twice, east twice, then in | 1 |
| 93 | throne room | move: to the king | |
| 94 | throne room | `said(bow to king)` | 3 |

## The gnome's name

`IFNKOVHGROGHPRM` is a literal string typed at the prompt, not a word in the
vocabulary — it is *Rumpelstiltskin* with the alphabet reversed, A for Z. Two
things follow for a test. The parser has to carry an unknown token through to
the script rather than rejecting it, and the string is case-sensitive to type
but not necessarily to match, which this file does not settle.

## What the engine made of it

`kq1.steps.ts` beside this file plays every row of the table above -- all
hundred and fifty-nine of the points they add up to -- which settles most of
the questions the table leaves open. What it found, so that the next reader
does not have to find it again:

- **The rooms.** The outdoors is a six-by-eight grid of screens wrapping at
  every edge, rooms 1 to 48, numbered along alternate rows in alternate
  directions; the interiors are numbered above it. The mapping from the names
  above to those numbers is the `ROOM` table in the steps file.
- **The order is not the source's.** Rows 65 to 91 -- the well, the dragon, the
  condor, the rat and the treasury -- are played *before* rows 55 to 64, the
  beanstalk and the clouds, and not after. The reason is the giant, below.
  Nothing else in the path depends on the order.
- **Two rows are not typed as written.** `push witch into oven` is four words
  and logic 65 tests `said(push, witch)`, which matches three, so the extra
  noun makes row 36 miss. And `open cupboard` and `take cheese` are one line
  each, not the two that rows 37 and 38 ask for -- two points apiece, which is
  the four row 38 claims for both.
- **Row 42 is not a scoring line on its own.** Giving the woodcutters an empty
  bowl pays three; saying `fill` in front of them then fills it and pays two,
  and *that* is what the fiddle is offered for. Filling it beforehand scores
  the same and leaves the fiddle on the wall.
- **Row 47 is three points for `open pouch`, not for looking in the stump.**
  The screen's total is right; the split across rows 45 to 47 is not.
- **Rows 22, 30 and 32 are dice, not waits.** The elf is in his room on a throw
  under 85 in 250 and then takes another 90 to 250 cycles to walk into sight;
  the witch is at home on half the throws, and on a quarter of the rest she
  never comes home at all. Each of them is played as leave-and-return.
- **Rows 61 and 62 cannot be played as written, and that is why the order
  changed.** There is no tree to stand behind: logic 58's screen is open cloud
  with a few one-pixel trunks on it, and the giant is `follow.ego` at ego's own
  speed, which in a closed room catches anybody -- a rollout of the chase says
  inside ninety cycles, whatever the player does, against the seven hundred and
  fifty the game wants before he falls asleep. Logic 58 asks instead for one of
  three protections, and any of them turns the giant from `follow.ego` into
  `wander`: the magic shield, the fairy godmother's spell, or the ring. The
  spell lasts two thousand five hundred cycles, which is not enough to cross
  the map to the clouds. The ring is spent: logic 0 takes its three points back
  when the spell runs out, and logic 52 takes them at the bottom of the well
  whether it has run out or not. Only the shield is still there afterwards --
  so the shield is fetched first, and rows 65 to 91 move in front of rows 55
  to 64 to fetch it.
- **Rows 65 and 92 are the two casualties of that.** Both are walks between
  screens, and in this order they join different screens. Row 65's two ponds
  west of the mountain are never crossed at all: the well is reached from the
  gnome instead, six screens south and east by the meadows the goat was led
  through, keeping clear of room 21 where the witch flies. And row 92's "north
  twice, east twice" is the walk home from the mossy rock, which in this order
  is three acts earlier; from the foot of the mountain the same castle door is
  three screens the other way.
- **Row 55's "east twice" is four, and not the two it looks like.** The screen
  directly west of the mossy rock the caverns let you out at is a swamp,
  walkable only round its rim and with no way across from the side you come in
  on. The flower meadow is reached round the north of it, by the woodcutters'
  cottage and the blue lake.
- **The well's points are paid on different rows than the source gives them.**
  `lower rope` pays nothing; the point row 69 gives it is logic 49's, for
  arriving in the shaft, which is row 70. Row 73's point is logic 51's, for
  arriving in the dragon's cave, and not for `go through hole` -- the way
  through is a two-pixel box you walk into, `posn(0,31,111,32,130)`, and there
  is no line to type. Rows 76 and 77 are the same again: `climb rope` pays
  nothing, and the four points are logic 52's, two for coming back from the
  dragon and two for the bucket refilling itself on the way. Every screen's
  total is right; the rows they are split across are not.
- **Row 71's `fill bucket` works as written**, though logic 49's own handler is
  `get water` and answers "You cannot get the water" -- logic 101 takes the
  line first, while swimming, and pays for it.
- **Row 79 is a jump, not a wait.** "Let the bird take you" is `said(jump)`:
  logic 22 wants flag 143, which is what jumping sets, and it counts only from
  between twenty and thirty-five away from the bird with Graham well below it.
  The bird `wander`s and is turned back north whenever it drops below y=115, so
  the place to jump from moves while you walk to it.
- **Row 82's hole is painted as water.** Logic 48 knows Graham has fallen in by
  flag 0, ego on water, which is also what stops a route planner walking into
  it. It is the only thing on this path that needs the harness's `{ swims }`,
  and the ponds the source wanted it for are never crossed.
- **Row 90 is one bite, not two.** `eat mushroom` shrinks Graham on the first
  line and answers "You can't eat the mushroom if you don't have it!" on the
  second, because he has eaten it.
- **The source's table is right and the game's own total is wrong.** Row for
  row, the table and the game agree: both add to a hundred and fifty-nine,
  where logic 0 puts a hundred and fifty-eight in `v7` and calls that the
  maximum. The odd point is the castle door. Logic 2 pays one for opening it --
  flag 193 -- and then one more for opening it a second time, flag 206, with
  nothing else asked; and coming home to the king means opening it a second
  time, because nothing else in that room admits anybody and the doors do not
  open for the returning hero on their own. So a finished game scores one past
  full marks. The discrepancy the table warns about is in the game.
- **Six bugs in the engine, all found by playing this.** `collides` counted the
  base row an object was *leaving* as a row it crossed, so a character who
  began a cycle beside another and stepped diagonally past him was refused the
  step and pinned there -- which the goat, following a pace behind and coming
  to rest at ego's shoulder, made permanent at row 51. `updatePositions`
  refused a step that would put a tall view's top above the picture, and threw
  away the screen edge it had just recorded when it did, so a tall view never
  reported touching the horizon and the beanstalk could not be climbed past its
  second screen. `saveArea` clipped only the far corner of a sprite's
  rectangle, so an object parked entirely off the picture indexed past the end
  of the screens. `follow.ego` re-chose its direction every cycle it was
  blocked instead of committing to a detour, which glues a follower to the far
  side of whatever it walked into. And the view table held sixteen slots
  against King's Quest's OBJECT file, which declares seventeen and means it:
  logic 77 animates object 16, and the leprechauns' treasury came up without
  it. `test/motion.test.ts` and `test/viewtable.test.ts` keep the cases.
- **Row 51's "west one" is a cul-de-sac.** West of the corral is the far half
  of the same goat pen, whose own logic says "the only way to get in is through
  the gate" -- and the gate is on the screen behind. Nor would it help: inside
  the pen ego wears view 67, Graham and the goat side by side, eighteen pixels
  wide against his usual six, and that fence's gaps are about six. South out of
  the gate and then west reaches the same bridge with the same goat, and the
  four points are paid.

## What the harness grew for it

One new kind of step, `stalk`, and King's Quest asks for it twice. Both the
condor and the rat have to be approached to a particular distance and no
nearer -- the bird takes nobody who is not between twenty and thirty-five away
and below it, the rat takes the cheese from between sixteen and thirty-four and
kills anyone who gets closer -- and neither distance can be reached by walking
to a spot, because both of them are walking too. `stalk` steers a cycle at a
time towards the gap it is asked for and stops there. It is `flee` with the
sign changed, and it sits beside it.

## What this does not pin down

Worth knowing before it is leaned on:

- **No room numbers.** Every location above is the source's own name for it. A
  test that wants to assert *where* the player is has to map these itself.
- **The score does not add up, and the source is not the one at fault.** The
  steps above total 159 against the game's stated maximum of 158. Playing them
  says the game pays exactly those 159 -- see *What the engine made of it* for
  which point the game gives away twice.
- **The vague steps are the timed ones.** "Avoid the wizard", "wait for the
  elf", "stay behind the tree until the giant sleeps", "let the bird take you"
  all depend on cycles and on where the player stands, and none of that is a
  command. These are the steps a scripted playthrough will fail on first.
- **One path only.** Where the game allows another order or another solution,
  this records the source's choice and nothing else.
