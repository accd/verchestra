// P2 acceptance probe for the #406 pilot, predeclared in ../spec.md. Copy it to
// the root of a verification clone checked out at the task commit, run it with
// Node 24.14.0, then delete the copy. It fails at the pinned target revision.
import assert from 'node:assert/strict'
import {levenshteinEditDistance, levenshteinSimilarity} from './index.js'

assert.equal(typeof levenshteinSimilarity, 'function', 'levenshteinSimilarity is exported')
assert.equal(levenshteinSimilarity('', ''), 1, 'two empty strings are identical')
assert.equal(levenshteinSimilarity('abc', 'abc'), 1, 'equal strings')
assert.equal(levenshteinSimilarity('a', ''), 0, 'nothing in common')
assert.equal(levenshteinSimilarity('', 'abc'), 0, 'nothing in common, reversed')
assert.equal(levenshteinSimilarity('sitting', 'kitten'), 1 - 3 / 7, 'sitting/kitten')
assert.equal(levenshteinSimilarity('kitten', 'sitting'), 1 - 3 / 7, 'order does not matter')
assert.equal(levenshteinSimilarity('A', 'a'), 0, 'case-sensitive by default')
assert.equal(levenshteinSimilarity('A', 'a', true), 1, 'insensitive when asked')
assert.equal(levenshteinEditDistance('sitting', 'kitten'), 3, 'distance unchanged')
console.log('P2 probe: PASS')
