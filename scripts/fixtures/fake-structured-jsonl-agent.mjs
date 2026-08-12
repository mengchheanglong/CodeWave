const hold = process.argv.includes('--hold');

process.stdout.write(`${JSON.stringify({ type: 'session', sequence: 1 })}\n`);

if (hold) {
  const timer = setInterval(() => {}, 10_000);
  process.on('SIGTERM', () => {
    clearInterval(timer);
    process.exit(0);
  });
} else {
  process.stdout.write('plain diagnostic output\n');
  process.stdout.write(`${JSON.stringify({ type: 'message', sequence: 2 })}\n`);
  process.stdout.write(`${'x'.repeat(256)}\n`);
  process.stderr.write('structured-agent warning\n');
  process.stdout.write(`${JSON.stringify({ type: 'result', sequence: 3 })}\n`);
}
