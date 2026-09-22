import MatchingBoard from './matching/Board';
import SortBoard from './sort/Board';
import MemoryBoard from './memory/Board';
import ParsonsBoard from './parsons/Board';
import PredictBoard from './predict/Board';
import BugHuntBoard from './bughunt/Board';
import FillBlankBoard from './fillblank/Board';

/*
 * Every game kind the app can play, keyed by the kind name the server uses
 * (the server's list is edupyramids-backend/src/games). A new kind is a new
 * folder here with a Board, plus one line below.
 *
 * `skill` is what the kind practises, shown on the Play screen so a student
 * can choose by what they want to get better at.
 */
export const GAME_KINDS = {
  matching: { label: 'Matching', icon: '🔗', skill: 'Recognise', Board: MatchingBoard },
  drag_drop: { label: 'Sorting', icon: '🗂️', skill: 'Recognise', Board: SortBoard },
  memory: { label: 'Memory tiles', icon: '🃏', skill: 'Recall', Board: MemoryBoard },
  fillblank: { label: 'Fill the blank', icon: '✏️', skill: 'Write', Board: FillBlankBoard },
  predict: { label: 'Predict the output', icon: '🔮', skill: 'Trace', Board: PredictBoard },
  parsons: { label: 'Parsons puzzle', icon: '🧩', skill: 'Write', Board: ParsonsBoard },
  bughunt: { label: 'Bug hunt', icon: '🐞', skill: 'Debug', Board: BugHuntBoard },
};

const UNKNOWN = { label: 'Game', icon: '🎲', skill: 'Play', Board: null };

export const kindOf = (kind) => GAME_KINDS[kind] || UNKNOWN;
