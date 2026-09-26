/*
 * HLD test C9: the teacher's class report opens in a spreadsheet with one row
 * per student.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classReportCsv } from './classCsv.js';

const parse = (csv) => csv.replace(/^﻿/, '').trim().split('\r\n')
  .map((line) => line.match(/"((?:[^"]|"")*)"/g).map((c) => c.slice(1, -1).replace(/""/g, '"')));

test('C9: a header and one row per student', () => {
  const rows = parse(classReportCsv([
    { name: 'Asha Rao', email: 'asha@school.in', attempts: 12, averagePercent: 81 },
    { name: 'Vikram Das', email: 'vikram@school.in', attempts: 0, averagePercent: null },
  ]));
  assert.deepEqual(rows, [
    ['Student', 'Email', 'Attempts', 'Average %'],
    ['Asha Rao', 'asha@school.in', '12', '81'],
    ['Vikram Das', 'vikram@school.in', '0', ''],       // no attempts: blank, not 0
  ]);
});

test('quotes and commas inside a name survive', () => {
  const [, row] = parse(classReportCsv([{ name: 'Rao, "Asha"', email: 'a@b.in', attempts: 1, averagePercent: 50 }]));
  assert.equal(row[0], 'Rao, "Asha"');
});

test('a value that looks like a formula is written as text', () => {
  const [, row] = parse(classReportCsv([{ name: '=HYPERLINK("http://x")', email: '+91 1234', attempts: 1, averagePercent: 1 }]));
  assert.equal(row[0], '\'=HYPERLINK("http://x")');
  assert.equal(row[1], "'+91 1234");
});

test('the file opens as UTF-8 in Excel', () => {
  const csv = classReportCsv([{ name: 'आशा', email: 'a@b.in', attempts: 1, averagePercent: 90 }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /आशा/);
});
