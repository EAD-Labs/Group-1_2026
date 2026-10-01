const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/database');
const { playable, srtToVtt } = require('../src/services/videoService');
const VIDEOS = require('../content/spoken-tutorial-videos.json');

/*
 * Spoken Tutorial lessons played inside the app: the video streams from their
 * server, the captions come through ours as WebVTT. spoken-tutorial.org is
 * faked here, as in the question generator's tests.
 */

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });
afterAll(() => pool.end());

const SRT = '﻿1\r\n00:00:01,000 --> 00:00:04,500\r\nWelcome to the spoken tutorial on <i>IPython</i>.\r\n\r\n'
  + '2\r\n00:00:05,000 --> 00:00:07,250\r\nIn this tutorial, we will learn\r\n';

test('SRT subtitles become WebVTT captions', () => {
  expect(srtToVtt(SRT)).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:04.500\nWelcome to the spoken tutorial on <i>IPython</i>.\n\n'
    + '00:00:05.000 --> 00:00:07.250\nIn this tutorial, we will learn\n');
});

test("Spoken Tutorial's own subtitle quirks are cleaned up", () => {
  const theirs = '<center><b>Narration</b></center>\r\n\r\n1\r\n00:00:01 --> 00:00:04\r\n'
    + 'Welcome to the spoken tutorial on <b>Loops</b>.\r\n\r\n2\r\n00:01:05 --> 00:01:09\r\n'
    + '<center><b>unpack</b> True --> returns</center> the array.\r\n';
  expect(srtToVtt(theirs)).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nWelcome to the spoken tutorial on <b>Loops</b>.\n\n'
    + '00:01:05.000 --> 00:01:09.000\n<b>unpack</b> True --&gt; returns the array.\n');
});

test('every lesson can be played in place, with its files next to its subtitles', () => {
  for (const v of VIDEOS) {
    const p = playable(v);
    expect(p.mp4).toBe(v.subtitles.replace(/\.srt$/, '.mp4'));
    expect(p.webm).toBe(v.subtitles.replace(/\.srt$/, '.webm'));
    expect(p.captions).toBe(`/api/videos/${v.slug}/captions.vtt`);
    expect(p.url).toBe(v.url);
  }
});

test('captions are served as WebVTT without signing in, fetched once and kept', async () => {
  const slug = VIDEOS[0].slug;
  const calls = [];
  global.fetch = async (url) => { calls.push(String(url)); return new Response(SRT, { status: 200 }); };

  const res = await request(app).get(`/api/videos/${slug}/captions.vtt`);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/^text\/vtt/);
  expect(res.text.startsWith('WEBVTT\n\n00:00:01.000')).toBe(true);
  expect(calls).toEqual([VIDEOS[0].subtitles]);

  await request(app).get(`/api/videos/${slug}/captions.vtt`);
  expect(calls).toHaveLength(1);
});

test('only listed lessons can be asked for, so no other address is ever fetched', async () => {
  global.fetch = async () => { throw new Error('must not be called'); };
  expect((await request(app).get('/api/videos/not-a-lesson/captions.vtt')).status).toBe(404);
});

test('their server being unreachable is a clear 502', async () => {
  global.fetch = async () => { throw new Error('offline'); };
  const res = await request(app).get(`/api/videos/${VIDEOS[1].slug}/captions.vtt`);
  expect(res.status).toBe(502);
  expect(res.body.error).toMatch(/spoken-tutorial.org/);
});
