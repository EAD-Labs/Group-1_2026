const { parseCsv, tidy } = require('../scripts/convert-moodle-csv');

test('handles quoted fields, doubled quotes and embedded newlines', () => {
  const rows = parseCsv('a,b\n1,"has, comma"\n2,"say ""hi"""\n3,"two\nlines"\n');
  expect(rows).toEqual([
    ['a', 'b'], ['1', 'has, comma'], ['2', 'say "hi"'], ['3', 'two\nlines'],
  ]);
});

test('strips the HTML the export wraps every field in', () => {
  expect(tidy('<p>linspace(-pi/2, pi/2, 100)</p>')).toBe('linspace(-pi/2, pi/2, 100)');
  expect(tidy('<p>a &amp; b &lt;c&gt;</p>')).toBe('a & b <c>');
  expect(tidy('<p>one</p>\n<p>  two  </p>')).toBe('one two');
});
