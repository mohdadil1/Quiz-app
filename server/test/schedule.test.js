// Scheduled start/end — runs on unsaved documents, no database needed
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Test = require('../models/Test');

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-12-01T10:00:00Z');

function makeTest(fields) {
  const t = new Test({
    teacher: new mongoose.Types.ObjectId(),
    class: new mongoose.Types.ObjectId(),
    name: 'T',
    subject: 'S',
    date: now,
    totalQuestions: 1,
    ...fields
  });
  t.saves = 0;
  t.save = async function () { this.saves += 1; return this; };
  return t;
}

test('opens a pending test once its start time passes', async () => {
  const t = makeTest({ status: 'PENDING', startAt: new Date(now - HOUR) });
  assert.equal(await t.applySchedule(now), true);
  assert.equal(t.status, 'RUNNING');
  assert.equal(t.saves, 1);
});

test('does nothing before the start time', async () => {
  const t = makeTest({ status: 'PENDING', startAt: new Date(+now + HOUR) });
  assert.equal(await t.applySchedule(now), false);
  assert.equal(t.status, 'PENDING');
  assert.equal(t.saves, 0);
});

test('closes the test at the end time', async () => {
  const t = makeTest({ status: 'RUNNING', startAt: new Date(now - 2 * HOUR), endAt: new Date(now - 1) });
  await t.applySchedule(now);
  assert.equal(t.status, 'COMPLETED');
});

test('each step fires once, so a manual change sticks', async () => {
  const t = makeTest({ status: 'PENDING', startAt: new Date(now - HOUR) });
  await t.applySchedule(now);
  t.status = 'PENDING'; // teacher pauses it again by hand
  assert.equal(await t.applySchedule(now), false);
  assert.equal(t.status, 'PENDING');

  const closed = makeTest({ status: 'RUNNING', endAt: new Date(now - 1) });
  await closed.applySchedule(now);
  closed.status = 'RUNNING'; // teacher reopens it
  await closed.applySchedule(now);
  assert.equal(closed.status, 'RUNNING');
});

test('a test with no schedule is left alone', async () => {
  const t = makeTest({ status: 'PENDING' });
  assert.equal(await t.applySchedule(now), false);
  assert.equal(t.saves, 0);
});
