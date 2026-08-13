const args = process.argv.slice(2);

if (args.includes('--version')) {
  process.stdout.write('0.0.0-codewave-fake-gemini-stream\n');
  process.exit(0);
}

process.stdout.write(
  `${JSON.stringify({ type: 'init', session_id: 'fake-gemini-stream-session' })}\n`,
);
process.stdout.write(
  `${JSON.stringify({ type: 'message', role: 'assistant', content: 'Calm ' })}\n`,
);
process.stdout.write(
  `${JSON.stringify({ type: 'tool_use', tool_id: 'gemini-tool-1', tool_name: 'read_file', parameters: { path: 'README.md' } })}\n`,
);
process.stdout.write(
  `${JSON.stringify({ type: 'tool_result', tool_id: 'gemini-tool-1', status: 'success', output: 'ok' })}\n`,
);
process.stdout.write('gemini plain diagnostic\n');
process.stdout.write(
  `${JSON.stringify({ type: 'message', role: 'assistant', content: 'waves' })}\n`,
);
process.stdout.write(
  `${JSON.stringify({ type: 'result', status: 'success', stats: { input_tokens: 2, output_tokens: 2 } })}\n`,
);
