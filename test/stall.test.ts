import { createStallWatch, STALL_AFTER_MS } from '@renderer/features/player/stall'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const sample = (at: number, currentTime: number, extra: Partial<{ paused: boolean; ended: boolean; seeking: boolean }> = {}) => ({
  at,
  currentTime,
  paused: false,
  ended: false,
  seeking: false,
  ...extra
})

console.log('\nA stream that is playing normally')

{
  const watch = createStallWatch(0)
  let stalled = false
  // Sampled once a second for a minute, the clock advancing as it should.
  for (let second = 1; second <= 60; second++) {
    if (watch.observe(sample(second * 1000, second))) stalled = true
  }
  check('is never called stalled', !stalled)
}

console.log('\nA stream that freezes')

{
  const watch = createStallWatch(0)
  watch.observe(sample(1000, 1))
  watch.observe(sample(2000, 2))

  // The clock stops here. Everything after this is the same frame.
  check('is not condemned on the first missed second', !watch.observe(sample(3000, 2)))
  check('nor after three', !watch.observe(sample(5000, 2)))
  check(
    'and not a moment before the threshold',
    !watch.observe(sample(2000 + STALL_AFTER_MS - 1, 2))
  )
  check('but is caught once it passes', watch.observe(sample(2000 + STALL_AFTER_MS, 2)))
  check('and stays caught', watch.observe(sample(2000 + STALL_AFTER_MS + 5000, 2)))
}

console.log('\nThings that are not stalls')

{
  // A paused video is the user's decision. Declaring it dead after nine
  // seconds would make the pause button a reconnect button.
  const watch = createStallWatch(0)
  let stalled = false
  for (let second = 1; second <= 60; second++) {
    if (watch.observe(sample(second * 1000, 5, { paused: true }))) stalled = true
  }
  check('a long pause is not a stall', !stalled)

  // And it must not fire the instant playback resumes either.
  check('and resuming gets the full grace period again', !watch.observe(sample(61_000, 5)))
  check('only stalling if it then really stops', watch.observe(sample(61_000 + STALL_AFTER_MS, 5)))
}

{
  const watch = createStallWatch(0)
  let stalled = false
  for (let second = 1; second <= 30; second++) {
    if (watch.observe(sample(second * 1000, 120, { seeking: true }))) stalled = true
  }
  check('a long seek is not a stall', !stalled)
}

{
  const watch = createStallWatch(0)
  let stalled = false
  for (let second = 1; second <= 30; second++) {
    if (watch.observe(sample(second * 1000, 300, { ended: true }))) stalled = true
  }
  check('a finished film is not a stall', !stalled)
}

{
  // Seeking backwards moves the clock the wrong way, which is still proof the
  // element is alive.
  const watch = createStallWatch(0)
  watch.observe(sample(1000, 600))
  check('jumping backwards counts as movement', !watch.observe(sample(2000, 120)))
  check('and the countdown restarts from there',
    !watch.observe(sample(2000 + STALL_AFTER_MS - 1, 120)))
}

{
  // Chromium reports currentTime in float seconds; a frozen element can wobble
  // in the last decimal places without a single frame being delivered.
  const watch = createStallWatch(0)
  watch.observe(sample(1000, 10))
  let stalled = false
  for (let i = 2; i <= 20; i++) {
    if (watch.observe(sample(i * 1000, 10 + (i % 2) * 0.001))) stalled = true
  }
  check('a frozen clock wobbling in its last decimals is still a stall', stalled)
}

console.log('\nA stream that opens but never plays a frame')

{
  // ffmpeg running with nothing to read looks exactly like this: a session
  // that opened cleanly and a picture that never arrives.
  const watch = createStallWatch(0)
  check('is given its grace period', !watch.observe(sample(1000, 0)))
  check('and then caught like any other stall', watch.observe(sample(STALL_AFTER_MS, 0)))
}

console.log('\nAfter reopening')

{
  const watch = createStallWatch(0)
  watch.observe(sample(1000, 4))
  check('a reopened stream is given the whole grace period',
    (watch.reset(50_000), !watch.observe(sample(50_000 + STALL_AFTER_MS - 1, 0))))
  check('and is judged from the reopen, not from before it',
    watch.observe(sample(50_000 + STALL_AFTER_MS, 0)))
}

console.log(failures === 0 ? '\nstall: all passed' : `\nstall: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
