import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormValidator } from '../dist/esm/index.js';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
test('typed field association sync errors and immutable output', () => {
  const v = createFormValidator({
    name: { sync: [(value) => (value ? [] : [{ code: 'required' }])] },
  });
  const r = v.validateSync({ name: '' });
  assert.equal(r.valid, false);
  assert.deepEqual({ ...r.errors }, { name: [{ code: 'required' }] });
  assert.throws(() => r.errors.name.push({ code: 'x' }), TypeError);
  assert.equal(v.validateSync({ name: 'ok' }).valid, true);
});
test('async result commits only completed generation', async () => {
  const wait = deferred();
  const v = createFormValidator({
    name: { async: [async (value) => (value === 'old' ? wait.promise : [])] },
  });
  const old = v.validate({ name: 'old' });
  const fresh = await v.validate({ name: 'new' });
  assert.equal(fresh.status, 'completed');
  assert.equal((await old).status, 'stale');
  wait.resolve([{ code: 'taken' }]);
  await Promise.resolve();
  assert.equal(v.latest(), fresh.result);
});
test('abort ignored rule can finish promptly and does not commit', async () => {
  const never = new Promise(() => {});
  const v = createFormValidator({ name: { async: [async () => never] } });
  const external = new AbortController();
  const run = v.validate({ name: 'x' }, external.signal);
  external.abort();
  assert.equal((await run).status, 'aborted');
  assert.equal(v.latest(), undefined);
  const internal = v.validate({ name: 'x' });
  v.abort();
  assert.equal((await internal).status, 'aborted');
});
test('already aborted run does not execute validators', async () => {
  let calls = 0;
  const v = createFormValidator({
    name: {
      sync: [
        () => {
          calls++;
          return [];
        },
      ],
      async: [
        async () => {
          calls++;
          return [];
        },
      ],
    },
  });
  const c = new AbortController();
  c.abort();
  assert.equal((await v.validate({ name: 'x' }, c.signal)).status, 'aborted');
  assert.equal(calls, 0);
});
test('configuration and primitive input snapshots are owned', async () => {
  const d = deferred(),
    rules = [
      async (_value, values) => {
        await d.promise;
        return values.name === 'first' ? [] : [{ code: 'changed' }];
      },
    ];
  const v = createFormValidator({ name: { async: rules } });
  const values = { name: 'first' },
    run = v.validate(values);
  values.name = 'changed';
  rules.length = 0;
  d.resolve([]);
  assert.equal((await run).result.valid, true);
});
test('sync async failures propagate but stale rejection is handled', async () => {
  const v = createFormValidator({
    name: {
      async: [
        async () => {
          throw new Error('rule failed');
        },
      ],
    },
  });
  await assert.rejects(v.validate({ name: 'x' }), /rule failed/);
  const bad = createFormValidator({ name: { sync: [() => [{ code: 'bad\n' }]] } });
  assert.throws(() => bad.validateSync({ name: 'x' }), TypeError);
  const asyncBad = createFormValidator({ name: { async: [async () => null] } });
  await assert.rejects(asyncBad.validate({ name: 'x' }), TypeError);
  const thrownUndefined = createFormValidator({
    name: {
      async: [
        async () => {
          throw undefined;
        },
      ],
    },
  });
  let caught = false;
  try {
    await thrownUndefined.validate({ name: 'x' });
  } catch (error) {
    caught = true;
    assert.equal(error, undefined);
  }
  assert.equal(caught, true);
  let rejectOld;
  const oldRejection = new Promise((_resolve, reject) => {
    rejectOld = reject;
  });
  const races = createFormValidator({
    name: { async: [async (value) => (value === 'old' ? oldRejection : [])] },
  });
  const old = races.validate({ name: 'old' });
  const fresh = await races.validate({ name: 'new' });
  assert.equal((await old).status, 'stale');
  rejectOld(undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(races.latest(), fresh.result);
});
test('malformed values ownership controls and limits', () => {
  assert.throws(() => createFormValidator({ name: { sync: Array(1) } }), TypeError);
  const v = createFormValidator({ name: {} });
  for (const input of [{}, { name: NaN }, { name: {} }, Object.create({ name: 'x' })])
    assert.throws(() => v.validateSync(input), TypeError);
  const x = {};
  Object.defineProperty(x, 'name', {
    get() {
      throw Error('executed');
    },
    enumerable: true,
  });
  assert.throws(() => v.validateSync(x), TypeError);
  assert.throws(() => createFormValidator({ name: { sync: Array(33).fill(() => []) } }), TypeError);
  assert.throws(() => createFormValidator({ name: { unknown: [] } }), TypeError);
  assert.throws(() => v.validateSync({ name: 'x'.repeat(65537) }), TypeError);
});
