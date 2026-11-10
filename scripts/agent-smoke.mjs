import { inferenceSmoke } from '../runtime/agents/smoke.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--run')) throw new Error('Usage: npm run agents:smoke -- [--run]');
  console.log(JSON.stringify(await inferenceSmoke(process.env, { run: args[0] === '--run' }), null, 2));
} catch (error) {
  // Provider errors are already sanitised; never print environment or HTTP bodies.
  console.error(error.message); process.exitCode = 1;
}
