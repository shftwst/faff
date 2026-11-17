import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPolicyReader } from '../eval/control-parity/policy-reader.mjs';

test('workflow calls remain blocked until every unchanged policy character has been delivered', async () => {
  const policy = 'first\n' + 'long policy '.repeat(2000) + '\nlast';
  const reader = createPolicyReader(Buffer.from(policy));
  let effects = 0;
  const call = reader.guard(async () => { effects++; return { completed: true }; });
  await assert.rejects(call('mutate', {}), /policy delivery incomplete/);
  let offset = 0, recovered = '';
  do {
    const reply = await call('read_policy', { offset });
    assert.ok(reply.text.length <= 6000);
    recovered += reply.text;
    offset = reply.next_offset;
  } while (offset !== null);
  assert.equal(recovered, policy);
  assert.equal(reader.capture().complete, true);
  await call('mutate', {});
  assert.equal(effects, 1);
});

test('skipping or forging a chunk cannot satisfy full policy delivery', async () => {
  const reader = createPolicyReader(Buffer.from('a'.repeat(13000)));
  const call = reader.guard(async () => true);
  await assert.rejects(call('read_policy', { offset: 6000 }), /next unread offset/);
  await call('read_policy', { offset: 0 });
  await call('read_policy', { offset: 0 });
  assert.equal(reader.capture().complete, false);
  await assert.rejects(call('finish', {}), /policy delivery incomplete/);
});
