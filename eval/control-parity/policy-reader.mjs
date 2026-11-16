import { sha256 } from './schema.mjs';

export const POLICY_TOOL = {
  name: 'read_policy',
  description: 'Read the unchanged policy in bounded chunks. Start at offset 0, then use each returned next_offset until it is null. Complete policy delivery is required before workflow operations. No scratch file is needed.',
  inputSchema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 } }, required: ['offset'], additionalProperties: false },
};

export function createPolicyReader(bytes) {
  const policy = bytes.toString('utf8'), reads = [], errors = [];
  let cursor = 0;
  const metadata = { bytes: bytes.length, utf16_characters: policy.length, sha256: sha256(bytes), chunk_limit: 6000 };
  return {
    metadata,
    guard(call) {
      return async (name, args) => {
        try {
          if (name === 'read_policy') {
            if (!args || Object.keys(args).join(',') !== 'offset' || !Number.isSafeInteger(args.offset) || args.offset < 0 || args.offset >= policy.length) throw new Error('invalid policy offset');
            const prior = reads.find(r => r.offset === args.offset);
            if (args.offset !== cursor && !prior) throw new Error('read_policy requires the next unread offset');
            let end = Math.min(args.offset + 6000, policy.length);
            if (end < policy.length && policy.charCodeAt(end - 1) >= 0xD800 && policy.charCodeAt(end - 1) <= 0xDBFF) end--;
            const text = policy.slice(args.offset, end);
            reads.push({ offset: args.offset, end, characters: text.length, bytes: Buffer.byteLength(text), sha256: sha256(text) });
            if (args.offset === cursor) cursor = end;
            return { text, next_offset: end === policy.length ? null : end, policy_sha256: metadata.sha256 };
          }
          if (!policy.length || cursor !== policy.length) throw new Error('policy delivery incomplete; read every chunk before workflow operations');
          return await call(name, args);
        } catch (error) {
          errors.push({ name, message: error.message });
          throw error;
        }
      };
    },
    capture() { return { ...metadata, complete: !!policy.length && cursor === policy.length, reads, errors }; },
  };
}
