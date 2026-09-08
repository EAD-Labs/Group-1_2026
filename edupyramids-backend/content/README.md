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
