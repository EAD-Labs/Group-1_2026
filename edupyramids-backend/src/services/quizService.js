const Quiz = require('../models/Quiz');
const { lessonsFor } = require('./lessonService');

/*
 * Delivering a quiz to a student.
 *
 * Separate from scoringService, which marks what comes back. The split matters
 * because of one rule: what goes out and what comes back are not the same
 * shape. The answer key and the explanations must not travel with the
 * questions, or the quiz can be read out of the browser's network tab.
 */

class QuizNotFound extends Error {
  constructor() {
    super('No such quiz');
    this.status = 404;
  }
}

async function listQuizzes({ topicId } = {}) {
  return Quiz.findAll({ topicId });
}

/**
 * One quiz with its questions, ready to send to a student.
 *
 * `Quiz.questionsFor` already leaves out `correct_answer`; the explanation is
 * dropped here for the same reason, since an explanation usually gives the
 * answer away. Both come back from scoringService once the attempt is marked.
 */
async function getQuizForStudent(quizId, lesson = null) {
  const quiz = await Quiz.findById(quizId);
  if (!quiz) throw new QuizNotFound();

  const questions = await Quiz.questionsFor(quizId);
  if (!lesson) return { ...quiz, questions };

  // One lesson: only its questions, in lesson order.
  const lessons = await lessonsFor(quizId);
  const one = lessons[lesson - 1];
  if (!one) throw new QuizNotFound();
  const byId = new Map(questions.map((q) => [q.id, q]));
  return {
    ...quiz,
    lesson: { index: one.index, count: lessons.length, title: one.title },
    questions: one.questionIds.map((id) => byId.get(id)),
  };
}

module.exports = { listQuizzes, getQuizForStudent, QuizNotFound };
