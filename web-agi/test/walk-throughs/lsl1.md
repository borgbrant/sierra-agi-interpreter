# Leisure Suit Larry I — walk-through, as engine input

A distilled step list for driving the engine through a full game, and for
judging whether it got there. Same shape as `kq1.md`: typed input and the score
it pays. Not prose.

```text
source      https://gamesolutions.efzeven.nl/leisure-suit-larry-in-the-land-of-the-lounge-lizards-agi-version-walkthrough-sierra-on-line1987/
also        https://sierrahelp.com/Walkthroughs/LSL1AGIWalkthrough.html
retrieved   2026-09-07
covers      one solution path, no alternate endings
game        the AGI release, which is the 2.440 copy in agi-extract/data/lsl1
```

The GameFAQs walkthrough originally asked for refuses automated requests with
HTTP 403, and that block was not worked around. Both sources above are written
for the **AGI** release specifically rather than the later VGA remake, which
matters: the two are different games and a VGA walkthrough would describe rooms
this copy does not have.

The first source is the one with the scoring. The second is coarser and has no
points, but it names rooms, which the first does not — keep it for the
room-level shape of the path.

Only the facts of the game are recorded here — the typed commands and the
points. Neither page's text is reproduced; read them at the links above.

## How to read the table

```text
#          order, as the source gives it. Every row is a line the player types
typed      `said(...)` is the parsed input, lower-cased from the source's caps
pts        points that action pays
total      the source's own running total at that point
```

Rows with no `pts` pay nothing; they are still typed, and still needed.

Movement between rooms is **not** in this table. The source describes walking in
prose and only marks up the typed lines, so what is here is every command and no
directions — the sibling source above is where the route lives.

## Checked against the game's own vocabulary

Every word of every command below was looked up in Larry's `WORDS.TOK`:

```text
99 distinct words, 94 of them in the vocabulary
not words        20, 555-6969, 555-8039, 209-6836858   -- literal numbers
two-word entry   `honeymoon suite` is one entry; `honeymoon` alone is not,
                 the same shape as `fire escape`
```

That is the useful result: across 161 commands the only tokens the vocabulary
does not hold are bare numbers. They are punctuation the tokeniser has to carry
through to the script rather than words to look up, which is the one parser
demand this walk-through makes that the King's Quest one does not.

## The path

| # | typed | pts | total |
|---|-------|-----|-------|
| 1 | `said(open door)` |  |  |
| 2 | `said(sit down)` |  |  |
| 3 | `said(order whiskey)` | 1 | 1 |
| 4 | `said(get up)` |  |  |
| 5 | `said(take rose)` | 1 | 2 |
| 6 | `said(give whiskey)` | 2 | 4 |
| 7 | `said(open door)` |  |  |
| 8 | `said(read wall)` | 2 | 6 |
| 9 | `said(look sink)` |  |  |
| 10 | `said(take ring)` | 3 | 9 |
| 11 | `said(use toilet)` | 1 | 10 |
| 12 | `said(get up)` |  |  |
| 13 | `said(open door)` |  |  |
| 14 | `said(call cab)` |  |  |
| 15 | `said(enter cab)` |  |  |
| 16 | `said(store)` |  |  |
| 17 | `said(pay driver)` |  |  |
| 18 | `said(get out)` | 1 | 11 |
| 19 | `said(look phone)` | 1 | 12 |
| 20 | `said(use phone)` |  |  |
| 21 | `said(555-6969)` | 2 | 14 |
| 22 | `said(take wine)` | 1 | 15 |
| 23 | `said(buy condom)` | 4 | 19 |
| 24 | `said(answer phone)` | 5 | 24 |
| 25 | `said(give wine)` | 5 | 29 |
| 26 | `said(call cab)` |  |  |
| 27 | `said(enter cab)` |  |  |
| 28 | `said(bar)` |  |  |
| 29 | `said(pay driver)` |  |  |
| 30 | `said(get out)` |  |  |
| 31 | `said(open door)` |  |  |
| 32 | `said(knock door)` |  |  |
| 33 | `said(ken sent me)` |  |  |
| 34 | `said(use remote)` | 3 | 32 |
| 35 | `said(change channel)` | 8 | 40 |
| 36 | `said(use breath spray)` |  |  |
| 37 | `said(get naked)` |  |  |
| 38 | `said(use condom)` | 10 | 50 |
| 39 | `said(fuck girl)` | 11 | 61 |
| 40 | `said(remove condom)` | 1 | 62 |
| 41 | `said(take candy)` | 2 | 64 |
| 42 | `said(open window)` |  |  |
| 43 | `said(climb out)` |  |  |
| 44 | `said(search dumpster)` |  |  |
| 45 | `said(take hammer)` | 3 | 67 |
| 46 | `said(get out)` |  |  |
| 47 | `said(call cab)` |  |  |
| 48 | `said(get in)` |  |  |
| 49 | `said(casino)` |  |  |
| 50 | `said(pay driver)` |  |  |
| 51 | `said(get out)` |  |  |
| 52 | `said(talk man)` | 1 | 68 |
| 53 | `said(buy apple)` | 3 | 71 |
| 54 | `said(play slots)` |  |  |
| 55 | `said(play blackjack)` |  |  |
| 56 | `said(change bet)` |  |  |
| 57 | `said(20)` |  |  |
| 58 | `said(look ashtray)` |  |  |
| 59 | `said(take card)` | 1 | 72 |
| 60 | `said(look card)` |  |  |
| 61 | `said(sit)` | 1 | 73 |
| 62 | `said(get up)` |  |  |
| 63 | `said(call cab)` |  |  |
| 64 | `said(get in)` |  |  |
| 65 | `said(store)` |  |  |
| 66 | `said(pay driver)` |  |  |
| 67 | `said(get out)` |  |  |
| 68 | `said(look magazines)` |  |  |
| 69 | `said(take magazine)` | 1 | 74 |
| 70 | `said(read magazine)` | 1 | 75 |
| 71 | `said(buy magazine)` |  |  |
| 72 | `said(use phone)` |  |  |
| 73 | `said(209-6836858)` | 5 | 80 |
| 74 | `said(show card)` | 5 | 85 |
| 75 | `said(sit)` | 1 | 86 |
| 76 | `said(look girl)` |  |  |
| 77 | `said(look girl)` | 1 | 87 |
| 78 | `said(talk girl)` | 1 | 88 |
| 79 | `said(talk girl)` |  |  |
| 80 | `said(give candy)` | 5 | 93 |
| 81 | `said(give rose)` | 5 | 98 |
| 82 | `said(give ring)` | 5 | 103 |
| 83 | `said(dance)` |  |  |
| 84 | `said(get up)` | 5 | 108 |
| 85 | `said(sit)` |  |  |
| 86 | `said(talk girl)` |  |  |
| 87 | `said(give money)` | 7 | 115 |
| 88 | `said(get up)` |  |  |
| 89 | `said(call cab)` |  |  |
| 90 | `said(get in)` |  |  |
| 91 | `said(casino)` |  |  |
| 92 | `said(pay driver)` |  |  |
| 93 | `said(get out)` |  |  |
| 94 | `said(open door)` |  |  |
| 95 | `said(get married)` | 12 | 127 |
| 96 | `said(press four)` |  |  |
| 97 | `said(knock door)` |  |  |
| 98 | `said(turn on radio)` | 5 | 128 |
| 99 | `said(talk fawn)` |  |  |
| 100 | `said(open door)` |  |  |
| 101 | `said(press one)` |  |  |
| 102 | `said(call cab)` |  |  |
| 103 | `said(get in)` |  |  |
| 104 | `said(store)` |  |  |
| 105 | `said(pay driver)` |  |  |
| 106 | `said(get out)` |  |  |
| 107 | `said(use phone)` |  |  |
| 108 | `said(555-8039)` |  |  |
| 109 | `said(wine)` |  |  |
| 110 | `said(honeymoon suite)` | 5 | 133 |
| 111 | `said(call cab)` |  |  |
| 112 | `said(get in)` |  |  |
| 113 | `said(casino)` |  |  |
| 114 | `said(pay driver)` |  |  |
| 115 | `said(get out)` |  |  |
| 116 | `said(press four)` |  |  |
| 117 | `said(knock door)` |  |  |
| 118 | `said(talk fawn)` |  |  |
| 119 | `said(pour wine)` |  |  |
| 120 | `said(undress)` |  |  |
| 121 | `said(use knife)` | 10 | 143 |
| 122 | `said(take rope)` | 3 | 146 |
| 123 | `said(open door)` |  |  |
| 124 | `said(press one)` |  |  |
| 125 | `said(call cab)` |  |  |
| 126 | `said(get in)` |  |  |
| 127 | `said(bar)` |  |  |
| 128 | `said(pay driver)` |  |  |
| 129 | `said(get out)` |  |  |
| 130 | `said(open door)` |  |  |
| 131 | `said(knock door)` |  |  |
| 132 | `said(ken sent me)` |  |  |
| 133 | `said(climb window)` |  |  |
| 134 | `said(tie rope to balcony)` |  |  |
| 135 | `said(tie rope to self)` |  |  |
| 136 | `said(get pills)` |  |  |
| 137 | `said(use hammer)` |  |  |
| 138 | `said(get pills)` | 8 | 154 |
| 139 | `said(go balcony)` |  |  |
| 140 | `said(untie rope)` |  |  |
| 141 | `said(get out)` |  |  |
| 142 | `said(call cab)` |  |  |
| 143 | `said(get in)` |  |  |
| 144 | `said(casino)` |  |  |
| 145 | `said(pay driver)` |  |  |
| 146 | `said(get out)` |  |  |
| 147 | `said(press eight)` |  |  |
| 148 | `said(look girl)` |  |  |
| 149 | `said(talk girl)` |  |  |
| 150 | `said(give pills to faith)` | 5 | 159 |
| 151 | `said(look desk)` |  |  |
| 152 | `said(push button)` | 5 | 164 |
| 153 | `said(open door)` |  |  |
| 154 | `said(look closet)` |  |  |
| 155 | `said(take doll)` | 5 | 169 |
| 156 | `said(inflate doll)` | 5 | 174 |
| 157 | `said(fuck doll)` | 8 | 182 |
| 158 | `said(look girl)` |  |  |
| 159 | `said(undress)` |  |  |
| 160 | `said(look girl)` |  |  |
| 161 | `said(give apple)` | 15 | 197 |
| — | act: the ending plays out | 25 | 222 |

## Scoring

The source marks points as `(gained/running total)` and ends at **222**.

One arithmetic slip, recorded rather than corrected: at the 38th marked award
the page reads `(5/128)`, but every award before it sums to 127, so a `+5` there
should give 132. Every other marker is internally consistent, and the running
total is monotonic throughout. Either that award is a typo for `+1` or the total
is short by 4 from there on — the source does not settle it, and neither does
this file.

Do not assert a running total from this table without re-deriving it. The same
caveat `kq1.md` carries, for the same reason, and there it is 159 against a
stated 158.

## What playing it settled

The playthrough in `walkthrough-lsl1.test.ts` reaches 222, and on the way it
answers two of the questions this file left open.

```text
step 73    `209-6836858` is not a spelling the game knows. Logic 22 keeps six
           of Sierra's own number and compares the typed line against all of
           them -- `(209) 683-6858`, `209 683-6858`, `2096836858`,
           `209683-6858`, `209 6836858` -- and none has a hyphen after the
           area code. `2096836858` pays the five points the table wants.
step 98    the `(5/128)` above is a typo for `+1`. Logic 41 awards `addn(3, 1)`
           for the radio, which makes 128 from the 127 before it, so the total
           is right and the award is wrong.
```

Neither is corrected in the table above: it records what the source says. The
sibling `lsl1.steps.ts` is where the game's own answer is played.

## What this does not pin down

- **No room numbers, and here not even room names.** The scoring source is a
  continuous narrative. Use the Sierra Help page for the route.
- **No movement.** See above: commands only.
- **The age quiz comes first.** The AGI release opens by asking multiple-choice
  questions before the game starts, and neither source covers them. A scripted
  playthrough has to get past that before step 1.
- **Money gates several steps, and the answer is save-scumming.** Playing
  blackjack up to a required amount is a loop with a random outcome and a
  save/restore around it, not a command sequence. Those steps cannot be replayed
  deterministically as written.
- **Several steps are timing-gated:** waiting for the cab, leaving and returning
  until the comic is on, the barrel man being present. These depend on cycles,
  and they are the steps a scripted playthrough will fail on first — the same
  caveat `kq1.md` ends on.
