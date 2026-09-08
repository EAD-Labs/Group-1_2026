const { query } = require('../config/database');

const SELECT = `
  SELECT c.id, c.name, c.school_id AS "schoolId",
         c.teacher_id AS "teacherId", u.name AS "teacherName",
         COUNT(cs.student_id)::int AS students
    FROM classes c
    LEFT JOIN users u ON u.id = c.teacher_id
    LEFT JOIN class_students cs ON cs.class_id = c.id`;

const GROUP = ' GROUP BY c.id, c.name, c.school_id, c.teacher_id, u.name ORDER BY c.name';

const Class = {
  all() {
    return query(SELECT + GROUP);
  },

  forTeacher(teacherId) {
    return query(`${SELECT} WHERE c.teacher_id = $1${GROUP}`, [teacherId]);
  },

  /** The classes a student is enrolled in. */
  forStudent(studentId) {
    return query(
      `${SELECT} WHERE c.id IN (SELECT class_id FROM class_students WHERE student_id = $1)${GROUP}`,
      [studentId],
    );
  },

  /** What this user is allowed to see, decided by their role. */
  visibleTo(user) {
    if (user.role === 'coordinator') return Class.all();
    if (user.role === 'teacher') return Class.forTeacher(user.userId);
    return Class.forStudent(user.userId);
  },
};

module.exports = Class;
