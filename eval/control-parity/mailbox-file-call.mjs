import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { callMailbox } from './interactive-handoff.mjs';

const [operation, directory, name, ...rest] = process.argv.slice(2);
if (operation !== 'call' || !directory || !name || rest.length) throw new Error('usage: mailbox-file-call.mjs call DIRECTORY TOOL');
const input = join(resolve(directory), 'bridge-arguments.json');
if (statSync(input).size > 1024 * 1024) throw new Error('oversized bridge arguments');
console.log(JSON.stringify(await callMailbox(resolve(directory), name, JSON.parse(readFileSync(input, 'utf8')))));
