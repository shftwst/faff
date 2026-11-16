import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { callMailbox } from './interactive-handoff.mjs';

const [operation, directory, name, argument, ...rest] = process.argv.slice(2);
if (operation !== 'call' || !directory || !name || !argument || rest.length) throw new Error('usage: mailbox-call.mjs call DIRECTORY TOOL JSON_OR_DASH');
const json = argument === '-' ? readFileSync(0, 'utf8') : argument;
if (Buffer.byteLength(json) > 1024 * 1024) throw new Error('oversized bridge arguments');
console.log(JSON.stringify(await callMailbox(resolve(directory), name, JSON.parse(json))));
