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

## What this does not pin down

Worth knowing before it is leaned on:

- **No room numbers.** Every location above is the source's own name for it. A
  test that wants to assert *where* the player is has to map these itself.
- **The score does not add up.** The source's steps total 159 against a stated
  maximum of 158, and the discrepancy is in the source rather than introduced
  here. Do not assert a running total from this file without re-deriving it.
- **The vague steps are the timed ones.** "Avoid the wizard", "wait for the
  elf", "stay behind the tree until the giant sleeps", "let the bird take you"
  all depend on cycles and on where the player stands, and none of that is a
  command. These are the steps a scripted playthrough will fail on first.
- **One path only.** Where the game allows another order or another solution,
  this records the source's choice and nothing else.
