const args = process.argv.slice(2);

if (args.includes('--version')) {
  process.stdout.write('0.0.0-codewave-fake-freebuff-bridge\n');
  process.exit(0);
}

if (args.includes('--codewave-bridge-info')) {
  process.stdout.write(
    `${JSON.stringify({ name: 'codewave-freebuff-bridge', protocolVersion: 1 })}\n`,
  );
  process.exit(0);
}

const promptIndex = args.indexOf('--prompt');
const prompt = promptIndex >= 0 ? args[promptIndex + 1] ?? '' : '';
if (!prompt.includes('[missing-hello]')) {
  process.stdout.write(
    `${JSON.stringify({ type: 'bridge.hello', protocolVersion: 1 })}\n`,
  );
}
const supportsSteering = prompt.includes('[native-steering]');
const acceptedSteering = [];
const delayMs = prompt.includes('[hold]')
  ? Math.max(1_000, Number(process.env.CODEWAVE_FAKE_FREEBUFF_HOLD_MS ?? 60_000))
  : prompt.includes('[native-steering]')
    ? Math.max(
        250,
        Number(process.env.CODEWAVE_FAKE_FREEBUFF_NATIVE_DELAY_MS ?? 900),
      )
    : Math.max(50, Number(process.env.CODEWAVE_FAKE_FREEBUFF_DELAY_MS ?? 350));

if (supportsSteering) {
  process.stdout.write(
    `${JSON.stringify({ type: 'capabilities', protocolVersion: 1, inFlightSteering: true })}\n`,
  );
  let inputBuffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    inputBuffer += chunk;
    let boundary = inputBuffer.indexOf('\n');
    while (boundary >= 0) {
      const line = inputBuffer.slice(0, boundary).trim();
      inputBuffer = inputBuffer.slice(boundary + 1);
      if (line) {
        const record = JSON.parse(line);
        if (
          record.type === 'steer' &&
          record.protocolVersion === 1 &&
          typeof record.steeringId === 'string'
        ) {
          const rejected = String(record.prompt).includes('[reject]');
          const acknowledge = () => {
            if (!rejected) acceptedSteering.push(String(record.prompt));
            process.stdout.write(
              `${JSON.stringify({
                type: 'steering',
                steeringId: record.steeringId,
                status: rejected ? 'rejected' : 'accepted',
                detail: rejected
                  ? 'Fixture rejected this steering input.'
                  : 'Fixture accepted this steering input.',
              })}\n`,
            );
          };
          if (prompt.includes('[terminal-before-ack]')) {
            setTimeout(acknowledge, delayMs + 500);
          } else {
            acknowledge();
          }
        }
      }
      boundary = inputBuffer.indexOf('\n');
    }
  });
  process.stdin.resume();
}

const timer = setTimeout(() => {
  const completedText = acceptedSteering.length
    ? `completed: ${prompt} | steered: ${acceptedSteering.join(' | ')}`
    : `completed: ${prompt}`;
  if (prompt.includes('[result-only]')) {
    process.stdout.write(
      `${JSON.stringify({ type: 'result', status: 'completed', result: completedText })}\n`,
    );
    process.exit(0);
  }
  if (prompt.includes('[invalid-records]')) {
    process.stdout.write('not-json-at-all\n');
    process.stdout.write('["arrays-are-not-bridge-records"]\n');
    process.stdout.write(`${JSON.stringify({ type: 'unknown-record', nested: { safe: true } })}\n`);
    process.stdout.write(`${JSON.stringify({ type: 'message', role: 42, content: 17 })}\n`);
  }
  process.stdout.write(
    `${JSON.stringify({ type: 'session', sessionId: 'fake-freebuff-session' })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ type: 'tool', status: 'requested', toolUseId: 'fake-tool-1', name: 'read', input: { path: 'README.md' } })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ type: 'tool', status: 'completed', toolUseId: 'fake-tool-1', name: 'read', output: 'ok' })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ type: 'checkpoint', title: 'fake-freebuff-checkpoint' })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ type: 'message', role: 'assistant', content: completedText })}\n`,
  );
  if (!prompt.includes('[missing-result]')) {
    process.stdout.write(
      `${JSON.stringify({ type: 'result', status: 'completed', result: completedText, usage: { input_tokens: 1, output_tokens: 1 } })}\n`,
    );
  }
  if (prompt.includes('[late-session]')) {
    process.stdout.write(
      `${JSON.stringify({ type: 'session', sessionId: 'late-session-overwrite' })}\n`,
    );
  }
  process.exit(0);
}, delayMs);

process.on('SIGTERM', () => {
  clearTimeout(timer);
  process.exit(0);
});
