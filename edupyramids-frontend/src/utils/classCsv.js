/*
 * The class report as a spreadsheet (HLD test C9: it opens in a spreadsheet
 * with one row per student).
 *
 * - A student with no attempts has a blank average, not 0: a 0 in a
 *   spreadsheet reads as a score of zero.
 * - A cell that starts with = + - or @ is written as text, so a name can never
 *   run as a formula when the file is opened (CSV injection).
 * - The file starts with a byte-order mark and uses CRLF line endings, so
 *   Excel opens it as UTF-8 and names in any script come out right.
 */
const cell = (value) => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export function classReportCsv(byStudent) {
  const rows = [
    ['Student', 'Email', 'Attempts', 'Average %'],
    ...byStudent.map((s) => [s.name, s.email, s.attempts, s.averagePercent ?? '']),
  ];
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
