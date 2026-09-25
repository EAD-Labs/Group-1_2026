-- Remove the placeholder topics the old seed script created.
--
-- Before the client's questions arrived, scripts/seed.js made six topics
-- (Variables, Loops, Lists, Dictionaries, Functions, Files) so the dashboards
-- had something to show. The real course arrived as levels, and those six
-- stayed empty, which made Progress read "1 of 10 topics" against a pyramid of
-- four tiers. Only a topic that is completely unused is removed: no quiz, no
-- game, no attempt, no checkpoint and no badge. Safe to re-run.
BEGIN;

DELETE FROM topics t
 WHERE t.name IN ('Variables', 'Loops', 'Lists', 'Dictionaries', 'Functions', 'Files')
   AND NOT EXISTS (SELECT 1 FROM quizzes q WHERE q.topic_id = t.id)
   AND NOT EXISTS (SELECT 1 FROM games g WHERE g.topic_id = t.id)
   AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.topic_id = t.id)
   AND NOT EXISTS (SELECT 1 FROM checkpoint_attempts c WHERE c.topic_id = t.id)
   AND NOT EXISTS (SELECT 1 FROM badges b WHERE b.topic_id = t.id);

COMMIT;
