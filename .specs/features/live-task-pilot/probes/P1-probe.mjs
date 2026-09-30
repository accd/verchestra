// P1 acceptance probe for the #406 pilot, predeclared in ../spec.md. Copy it to
// the root of a verification clone checked out at the task commit, run it with
// Node 24.14.0, then delete the copy. It fails at the pinned target revision.
import assert from 'node:assert/strict'
import cp from 'node:child_process'

function run(chunks, gapMs) {
  return new Promise((resolve) => {
    const child = cp.spawn('./cli.js', [], {stdio: ['pipe', 'pipe', 'pipe']})
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (code) => resolve({code, stdout, stderr}))
    let index = 0
    const next = () => {
      const chunk = chunks[index++]
      if (index === chunks.length) child.stdin.end(chunk)
      else {
        child.stdin.write(chunk)
        setTimeout(next, gapMs)
      }
    }
    next()
  })
}

const split = await run(['sturgeon', ' urgently'], 250)
assert.deepEqual([split.code, split.stdout], [0, '6\n'], 'two stdin chunks form one input')
const three = await run(['sat', 'urday,', 'sunday\n'], 150)
assert.deepEqual([three.code, three.stdout], [0, '3\n'], 'three stdin chunks form one input')
const single = await run(['sitting kitten\n'], 0)
assert.deepEqual([single.code, single.stdout], [0, '3\n'], 'single chunk still works')
const short = await run(['sturgeon'], 0)
assert.equal(short.code, 1, 'one word still exits 1')
assert.match(short.stderr, /Usage: levenshtein-edit-distance/, 'one word still prints usage')
console.log('P1 probe: PASS')
