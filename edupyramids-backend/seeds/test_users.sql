-- Development seed data.
--
-- Every account here signs in with the password: password123
-- These are development accounts. Do not load this file anywhere real.
--
-- `npm run seed` does the same thing and hashes the password at run time,
-- which is preferable: a hash committed to a repository is a hash somebody
-- eventually reuses. This file exists for anyone seeding with psql alone:
--
--   psql -U postgres -d edupyramids_dev -f seeds/test_users.sql
--
-- Safe to re-run.

BEGIN;

INSERT INTO topics (name, level, sort_order) VALUES
  ('Variables', 1, 0),
  ('Loops', 1, 1),
  ('Lists', 2, 2),
  ('Dictionaries', 2, 3),
  ('Functions', 3, 4),
  ('Files', 3, 5)
ON CONFLICT (name) DO NOTHING;

INSERT INTO users (email, password_hash, name, role, school_id) VALUES
  ('student1@school.com', '$2a$10$2/hUqL0EI/uzi/xGLN276uwkGZtr.8JyStI6iyRyaEbrNFcf.biAa', 'Aditya Sharma', 'student', 'school_001'),
  ('student2@school.com', '$2a$10$2/hUqL0EI/uzi/xGLN276uwkGZtr.8JyStI6iyRyaEbrNFcf.biAa', 'Priya Sundaram', 'student', 'school_001'),
  ('student3@school.com', '$2a$10$2/hUqL0EI/uzi/xGLN276uwkGZtr.8JyStI6iyRyaEbrNFcf.biAa', 'Rahul Menon', 'student', 'school_001'),
  ('teacher1@school.com', '$2a$10$2/hUqL0EI/uzi/xGLN276uwkGZtr.8JyStI6iyRyaEbrNFcf.biAa', 'Mrs Rao', 'teacher', 'school_001'),
  ('teacher2@school.com', '$2a$10$2/hUqL0EI/uzi/xGLN276uwkGZtr.8JyStI6iyRyaEbrNFcf.biAa', 'Mr Iyer', 'teacher', 'school_001'),
  ('coordinator@school.com', '$2a$10$2/hUqL0EI/uzi/xGLN276uwkGZtr.8JyStI6iyRyaEbrNFcf.biAa', 'Mr Johnson', 'coordinator', 'school_001')
ON CONFLICT (email) DO NOTHING;

-- Two classes with two different teachers, because one class cannot show that
-- Teacher A is kept out of Class B.
INSERT INTO classes (name, teacher_id, school_id)
SELECT 'Grade 9-A', id, 'school_001' FROM users WHERE email = 'teacher1@school.com'
  AND NOT EXISTS (SELECT 1 FROM classes WHERE name = 'Grade 9-A');

INSERT INTO classes (name, teacher_id, school_id)
SELECT 'Grade 9-B', id, 'school_001' FROM users WHERE email = 'teacher2@school.com'
  AND NOT EXISTS (SELECT 1 FROM classes WHERE name = 'Grade 9-B');

-- student3 is enrolled but never attempts anything, so the "No attempts yet"
-- state has something real to show.
INSERT INTO class_students (class_id, student_id)
SELECT c.id, u.id FROM classes c, users u
 WHERE (c.name, u.email) IN
       (('Grade 9-A', 'student1@school.com'),
        ('Grade 9-A', 'student2@school.com'),
        ('Grade 9-B', 'student3@school.com'))
ON CONFLICT DO NOTHING;

COMMIT;
