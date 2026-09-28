/*
 * Question text with code in it: code blocks keep their lines and
 * indentation, and text without backticks reads exactly as before.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { blocks, inlinePieces, plain } from './richText.js';

test('plain text is one prose block, unchanged', () => {
  assert.deepEqual(blocks('What is the index of the first element of a list?'), [
    { kind: 'prose', pieces: [{ kind: 'text', value: 'What is the index of the first element of a list?' }] },
  ]);
});

test('a code block keeps its lines and indentation', () => {
  const out = blocks('What does this print?\n```\nfor i in range(3):\n    print(i)\n```');
  assert.equal(out.length, 2);
  assert.equal(out[0].pieces[0].value, 'What does this print?');
  assert.deepEqual(out[1], { kind: 'code', value: 'for i in range(3):\n    print(i)' });
});

test('prose after a block, and two blocks in one question', () => {
  const out = blocks('Make it print:\n```\n11111\n```\nThe code:\n```\nprint(____ * 5)\n```');
  assert.deepEqual(out.map((b) => b.kind), ['prose', 'code', 'prose', 'code']);
  assert.equal(out[2].pieces[0].value, 'The code:');
});

test('`code` inside a sentence', () => {
  assert.deepEqual(inlinePieces('What does `len(a)` give?'), [
    { kind: 'text', value: 'What does ' },
    { kind: 'code', value: 'len(a)' },
    { kind: 'text', value: ' give?' },
  ]);
  assert.deepEqual(inlinePieces('`print(x + y)`'), [{ kind: 'code', value: 'print(x + y)' }]);
});

test('a lone backtick is left as it is', () => {
  assert.deepEqual(inlinePieces("It's a ` mark"), [{ kind: 'text', value: "It's a ` mark" }]);
});

test('plain() gives one line for short lists', () => {
  assert.equal(plain('What does this print?\n```\nx = 1\nprint(x)\n```'), 'What does this print? x = 1; print(x)');
  assert.equal(plain('Is `x` even?'), 'Is x even?');
});
