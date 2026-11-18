"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareContext = prepareContext;
exports.cmdPrepContext = cmdPrepContext;
// === region:factory — prep-context: local per-round context composition ===
const fs = require("node:fs");
const path = require("node:path");
const node_crypto_1 = require("node:crypto");
const scope = require('./ratified-scope.js');
const pin = require('./spec-review-pin.js');
function prepareContext(input) {
    const warnings = [];
    const result = { status: 'failed', assembly_exit: null, file: null, sha256: null, warnings, diagnostic: null };
    if (!input.issue || input.issue === '.' || input.issue === '..' || /[\/\\\x00-\x20]/.test(input.issue)) {
        result.diagnostic = 'issue must be a single non-empty path component';
        return result;
    }
    const root = path.resolve(input.root);
    const runDir = input.runDir ? path.resolve(root, input.runDir) : null;
    const scratch = path.resolve(root, pin.specReviewDir(input.issue, runDir));
    const file = path.join(scratch, 'ratified-scope.md');
    const stderr = path.join(scratch, 'ratified-scope.stderr');
    try {
        const targets = [file, stderr, runDir ?? root];
        for (let current = scratch; current !== (runDir ?? root); current = path.dirname(current))
            targets.push(current);
        for (const target of targets) {
            try {
                if (fs.lstatSync(target).isSymbolicLink())
                    throw new Error('scratch output must not traverse a symbolic link');
            }
            catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
                    throw error;
            }
        }
        fs.mkdirSync(scratch, { recursive: true });
        let container = null;
        if (runDir) {
            try {
                const ledger = JSON.parse(fs.readFileSync(path.join(runDir, 'run-ledger.json'), 'utf8'));
                if (ledger && typeof ledger === 'object' && 'prd_root_container' in ledger) {
                    const value = ledger.prd_root_container;
                    if (typeof value === 'string' && value)
                        container = value;
                    else if (value)
                        warnings.push('run ledger container is not a string; assembling without a container');
                }
            }
            catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
                    warnings.push('run ledger could not be read; assembling without a container');
            }
        }
        let assembled;
        try {
            assembled = scope.assemble(root, container);
        }
        catch (error) {
            fs.rmSync(file, { force: true });
            result.status = 'needs-human';
            result.assembly_exit = 2;
            result.diagnostic = error instanceof Error ? error.message : 'ratified scope source unreadable';
            fs.writeFileSync(stderr, [...warnings, result.diagnostic].join('\n') + '\n');
            return result;
        }
        result.assembly_exit = assembled.exit;
        warnings.push(...assembled.warnings);
        fs.writeFileSync(stderr, warnings.length ? warnings.join('\n') + '\n' : '');
        if (assembled.exit === 0)
            fs.writeFileSync(file, assembled.block);
        else
            fs.rmSync(file, { force: true });
        // Fold input is already gathered, classified and deduplicated by the caller.
        if (Buffer.byteLength(input.resolutionsText) > scope.VALIDATE_MAX_BYTES)
            throw new Error('resolutions exceed one MiB');
        const resolutions = JSON.parse(input.resolutionsText);
        if (!Array.isArray(resolutions))
            throw new Error('expected a JSON array of resolutions');
        if (resolutions.length) {
            const head = assembled.exit === 0 ? '' : '## Ratified scope\n\n' + scope.PROVENANCE_SENTENCE + '\n';
            fs.appendFileSync(file, head + '\n' + scope.renderInertResolutions(resolutions));
        }
        if (fs.existsSync(file)) {
            result.file = file;
            result.sha256 = (0, node_crypto_1.createHash)('sha256').update(fs.readFileSync(file)).digest('hex');
            result.status = 'ready';
        }
        else
            result.status = 'absent';
    }
    catch (error) {
        result.diagnostic = error instanceof Error ? error.message : 'context preparation failed';
    }
    return result;
}
function cmdPrepContext(args) {
    const usage = 'faff prep-context --issue ISSUE --root DIR [--run-dir DIR] --resolutions-file FILE|-';
    const values = new Map();
    try {
        for (let i = 0; i < args.length; i += 2) {
            const flag = args[i], value = args[i + 1];
            if (!flag || !['--issue', '--root', '--run-dir', '--resolutions-file'].includes(flag) || values.has(flag) || !value || value.startsWith('--'))
                throw new Error(usage);
            values.set(flag, value);
        }
        const issue = values.get('--issue'), root = values.get('--root'), source = values.get('--resolutions-file');
        if (!issue || !root || !source)
            throw new Error(usage);
        let text;
        if (source === '-') {
            const read = scope.readStdinCapped(scope.VALIDATE_MAX_BYTES);
            if (read.over)
                throw new Error('resolutions exceed one MiB');
            text = read.text;
        }
        else {
            if (fs.statSync(source).size > scope.VALIDATE_MAX_BYTES)
                throw new Error('resolutions exceed one MiB');
            text = fs.readFileSync(source, 'utf8');
        }
        const result = prepareContext({ issue, root, runDir: values.get('--run-dir') ?? null, resolutionsText: text });
        process.stdout.write(JSON.stringify(result) + '\n');
        return result.status === 'ready' ? 0 : result.status === 'absent' ? 3 : 2;
    }
    catch (error) {
        process.stderr.write(`prep-context: ${error instanceof Error ? error.message : 'invalid input'}\n`);
        return 2;
    }
}
