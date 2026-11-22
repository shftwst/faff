#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { serveReviewComments } from './lib/review-comment-server.js';

try {
  if (process.argv.length !== 3 || !process.argv[2]) throw new Error('usage: node faff-review-comments.mjs <tracker-config.json>');
  const bytes = readFileSync(process.argv[2]);
  if (bytes.length > 65536) throw new Error('tracker configuration exceeds 64 KiB');
  const config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  await serveReviewComments(config);
} catch (error) {
  process.stderr.write(`faff-review-comments: ${error.message}\n`);
  process.exitCode = 1;
}
