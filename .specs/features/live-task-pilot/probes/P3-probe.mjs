// P3 acceptance probe for the #406 pilot, predeclared in ../spec.md. Copy it to
// the root of a verification clone checked out at the task commit, run it with
// Node 24.14.0, then delete the copy. It fails at the pinned target revision.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parseInput} from './lib/cli-input.js'

assert.deepEqual(parseInput('sitting kitten'), ['sitting', 'kitten'], 'spaces')
assert.deepEqual(parseInput('sitting,kitten'), ['sitting', 'kitten'], 'commas')
assert.deepEqual(parseInput('sitting, kitten'), ['sitting', 'kitten'], 'commas and spaces')
assert.deepEqual(parseInput('saturday\tsunday'), ['saturday', 'sunday'], 'tabs')
assert.equal(parseInput('sitting'), undefined, 'one word')
assert.equal(parseInput('a b c'), undefined, 'three words')
// Behaviour preservation: the pinned revision rejects these, so must the refactor.
assert.equal(parseInput(' sitting kitten'), undefined, 'leading separator preserved')
assert.equal(parseInput('sitting kitten,'), undefined, 'trailing separator preserved')
const cli = String(fs.readFileSync('cli.js'))
assert.match(cli, /from '\.\/lib\/cli-input\.js'/, 'cli.js imports the extracted module')
assert.doesNotMatch(cli, /split\(','\)/, 'cli.js no longer splits input itself')
const pack = JSON.parse(String(fs.readFileSync('package.json')))
assert.ok(pack.files.some((entry) => entry === 'lib/' || entry === 'lib' || entry === 'lib/cli-input.js'), 'package.json files publishes lib')
console.log('P3 probe: PASS')
