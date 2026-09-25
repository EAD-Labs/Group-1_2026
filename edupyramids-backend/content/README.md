# Question content format

This is the file the client fills in, and the only thing the app loads questions
from. `sample-questions.json` in this folder is a working example — three
topics, written by the development team purely so the import and the marking can
be built and tested. **It is not course content and must be replaced before the
pilot.**

## Shape

One JSON file. A list of topics, each holding a list of quizzes, each holding a
list of questions.

```json
[
  {
    "topic": "Loops",
    "level": 2,
    "quizzes": [
      {
        "title": "Loop basics",
        "difficulty": 1,
        "questions": [
          {
            "text": "What does range(1, 5) produce?",
            "options": { "a": "1, 2, 3, 4", "b": "1, 2, 3, 4, 5" },
            "correct": "a",
            "explanation": "range stops one before the second number."
          }
        ]
      }
    ]
  }
]
```

## Rules the importer enforces

An import either loads the whole file or changes nothing at all. There is no
half-loaded state to clean up.

| Field | Rule |
| --- | --- |
| `topic` | Required, non-empty. Reused if it already exists. |
| `level` | Optional, whole number, defaults to 1. Which level unlocks the topic. |
| `quizzes[].title` | Required, non-empty. |
| `quizzes[].difficulty` | Optional, whole number, defaults to 1. |
| `questions[].text` | Required, non-empty. |
| `questions[].options` | At least `a` and `b`. `c` and `d` optional. |
| `questions[].correct` | Required. Must be one of the option letters **that this question actually has**. |
| `questions[].explanation` | Optional, but strongly wanted — see below. |

A question whose `correct` letter has no matching option is the error worth
naming: it looks fine to a reader and it silently marks every student wrong.
The importer refuses the file and prints the exact path, for example
`topics[1].quizzes[0].questions[4]: correct "c" has no matching option`.

## About explanations

`explanation` is what the student sees after answering. Without it the result
screen can only say right or wrong, which is the thing the whole project set out
to fix (HLD Section 3.1). The importer allows a missing explanation but counts
them and warns, so a file that has none is obvious rather than quiet.

## Loading a file

```bash
node scripts/import-questions.js content/sample-questions.json
node scripts/import-questions.js content/client-questions.json --replace
```

Without `--replace`, topics and quizzes already present are left alone and only
new ones are added. With `--replace`, the questions of any quiz named in the
file are cleared and reloaded, which is what to use when the client sends a
corrected version. Attempts already recorded are never touched.

Run it with no arguments to check a file without writing anything:

```bash
node scripts/import-questions.js content/client-questions.json --dry-run
```

## Loading a Moodle export

The client's questions arrive as a Moodle CSV — one row per answer option,
grouped by `question_id`, with the correct one marked `fraction = 1`. Convert
first, then import:

```bash
node scripts/convert-moodle-csv.js "Python - Python.csv" content/python-mcqs.json
node scripts/import-questions.js content/python-mcqs.json --replace
```

Two things the converter does not do, on purpose:

- **It does not invent topics.** The export's only grouping is
  `category_name`, and those categories are difficulty levels (Bronze, Silver,
  Gold, Post-test), not subjects. Nothing in the file says what any question is
  *about*, so the levels become the topics. If the client wants Loops and
  Dictionaries as topics, they need to say which question belongs where.
- **It does not write explanations.** The export has no column for one. Every
  question imports with a warning, and the result screen can only say right or
  wrong until the client supplies them.

# Game content format

Games live in `python-games.json`, loaded with
`node scripts/import-games.js content/python-games.json` (`--dry-run` to check,
`--replace` to update games already loaded). Same rule as questions: the whole
file loads, or nothing does.

A list of topics, each with a list of games. Every game has a `title`, a
`kind` and optional `instructions`. The rest depends on the kind:

```json
[
  {
    "topic": "Silver Level",
    "level": 2,
    "games": [
      { "title": "Ranges", "kind": "matching",
        "pairs": [{ "left": "list(range(3))", "right": "[0, 1, 2]", "explanation": "…" }] },

      { "title": "Sort by type", "kind": "drag_drop",
        "buckets": ["int", "float"],
        "items": [{ "text": "7 / 2", "bucket": "float", "explanation": "…" }] },

      { "title": "Loop outputs", "kind": "memory",
        "pairs": [{ "a": "print(max([4, 9, 2]))", "b": "9", "explanation": "…" }] }
    ]
  }
]
```

| Kind | What the student does | Score |
| --- | --- | --- |
| `matching` | Pairs each `left` with its `right` | One point per correct pair |
| `drag_drop` | Sorts each item into a bucket | One point per item in the right bucket |
| `memory` | Flips tiles to find each `a` and its `b` | One point per pair found; two free misses per pair, then a point off for every two misses |

The importer refuses a file where two answers or tiles in one game have the
same text (a right answer could be marked wrong), an item names a bucket the
game does not have, or a game has fewer than two pairs, buckets or items.

## The newer game kinds

These follow the same file and the same rules. Every kind's exact checks live
in `src/games/<kind>.js`; run the importer with `--dry-run` to see them applied.

**`parsons`** — put scrambled lines in order, with indentation.

```json
{ "title": "Sum of even numbers", "kind": "parsons",
  "lines": [
    { "code": "total = 0", "indent": 0 },
    { "code": "for i in range(1, 11):", "indent": 0 },
    { "code": "if i % 2 == 0:", "indent": 1 },
    { "code": "total = total + i", "indent": 2 },
    { "code": "print(total)", "indent": 0 }
  ],
  "distractors": ["for i in range(1, 10):"],
  "explanation": "…" }
```

Lines are listed in the right order. Each indents at most one level deeper than
the line before. No two lines (including distractors) may be identical.
Scored by the longest run of lines in the right order at the right indent,
minus one for each distractor used.

**`predict`** — type exactly what the code prints.

```json
{ "title": "Trace the loop", "kind": "predict",
  "items": [{ "code": "for i in range(3):\n    print(i)", "output": "0\n1\n2", "explanation": "…" }] }
```

Run every `code` in Python and paste its real output: trailing spaces and line
endings are ignored, everything else must match.

**`bughunt`** — find the line with the bug, then pick the fix.

```json
{ "title": "Fix the function", "kind": "bughunt",
  "items": [{ "code": "def greet(name)\n    return name", "bugLine": 1,
              "fixes": ["def greet(name):", "def greet name:"], "fix": 0, "explanation": "…" }] }
```

`bugLine` counts from 1. `fix` is the index of the right entry in `fixes`
(2 to 4 options). A point for the line, a second for the fix.

**`fillblank`** — fill each `___` with a chip.

```json
{ "title": "Complete the code", "kind": "fillblank",
  "items": [{ "code": "x = 7\nprint(x ___ 2)   # prints 1", "blanks": ["%"], "decoys": ["//", "/"], "explanation": "…" }] }
```

One entry in `blanks` per `___`, in order. At least one decoy, and no decoy may
also be a right answer.

### Concepts

Every game should name the concepts it practises, with slugs from
`concepts.json`, for example `"concepts": ["loops", "conditions"]`. A finished
game then counts as evidence for those concepts in the mastery model. The
importer refuses an unknown slug and warns about a game with none. Tags are
refreshed on every import, even for games already loaded.

## Games whose answers come from running Python

For these two kinds you write the code; `scripts/run-python-games.py` runs it
in real Python and fills in the answers. Never type `outputs` or `steps` by
hand. After editing, run:

```bash
python scripts/run-python-games.py content/python-games.json          # fill in
python scripts/run-python-games.py content/python-games.json --check  # what CI runs
```

**`bugcatch`** (Bug Catcher): a working function plus 1 to 4 bugged copies.
Students pick test inputs and say what the working function returns; a test
catches every copy that answers differently. Give 2 to 6 `inputs`, written as
the arguments of a call. Every copy must be caught by at least one input, and
two copies that always answer alike make a dull puzzle. Test slots are par + 1,
where par is the fewest inputs that catch every copy.

```json
{ "title": "Catch the loop bugs", "kind": "bugcatch",
  "items": [{
    "code": "def total_to(n):\n    total = 0\n    …",
    "call": "total_to",
    "task": "Adds up the whole numbers from 1 to n.",
    "inputs": ["0", "1", "5"],
    "mutants": [{ "code": "def total_to(n):\n    …range(1, n)…", "bug": "range(1, n) stops at n - 1." }],
    "hint": "…", "explanation": "…"
  }] }
```

Outputs are Python's `repr()`, so `'A'` and `5.0` are different from `A` and
`5`. An input that raises an error has the error's name as its output.

**`trace`** (Trace Runner): students type each value a watched variable gets,
line by line. Module-level code only (no functions), at most 14 steps.

```json
{ "title": "Trace the loops", "kind": "trace",
  "items": [{ "code": "total = 0\nfor i in range(1, 5):\n    …", "watch": ["i", "total"], "explanation": "…" }] }
```

## Stars and hints

Every game gives up to three stars: one at 60%, two for everything right,
three for everything right with no hints (and, in Bug Catcher, no more tests
than par). Parsons, Predict, Bug hunt, Bug Catcher and Trace Runner have
hints. The server records each one, and each costs the third star.

### Adding a new kind of game

1. `edupyramids-backend/src/games/<kind>.js` with `validate`, `contentOf`,
   `deliver`, `mark` and `offlineKey` (plus `check` for instant feedback during
   play, and `hint` if it has hints), then add it to `src/games/index.js`.
2. `edupyramids-frontend/src/games/<kind>/Board.jsx`, then add it to
   `src/games/registry.js`, and a marker for it in `src/offline/markers.js`.
3. Add a `perfect` answer builder for it in `tests/gameKinds.test.js`, and
   answer builders in `tests/offline.test.js` and the frontend's
   `markers.test.js`; the shared checks then cover it automatically.
