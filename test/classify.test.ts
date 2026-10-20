import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandFamily, failureReason } from '../src/classify.ts';

test('recognizes common purposes, assignments, paths, quotes, and same-family compounds', () => {
  const cases: [string, string][] = [
    ['rg -n "hello; world" src', 'text_search'], ['grep x a && rg y b', 'text_search'],
    ['ls src; find test -name "*.ts"', 'file_discovery'], ['git status && git diff', 'git'],
    ['npm test', 'tests_builds'], ['npm run typecheck', 'tests_builds'], ['npm install x', 'package_management'],
    ['node --test test/*.test.ts', 'tests_builds'], ['python3 -m pytest', 'tests_builds'],
    ['git diff 2>&1', 'git'], ['rg foo a 2>/dev/null', 'text_search'],
    ['python3 -c "print(1)"', 'scripts'], ['/usr/bin/git status', 'git'], ['CI=1 npm test', 'tests_builds'],
    ['curl https://example.test', 'network'], ['mkdir -p tmp', 'file_operations'], ['cat README.md', 'file_reading'],
    ['playwright test', 'tests_builds'], ['swift test', 'tests_builds'], ['xcodebuild test', 'tests_builds'],
  ];
  for (const [command, expected] of cases) assert.equal(commandFamily(command).label, expected, command);
});

test('runner wrappers are transparent to command purpose', () => {
  const cases: [string, string][] = [
    ['npx vitest run test/a.test.ts', 'tests_builds'],
    ['npx --yes vitest run test/a.test.ts', 'tests_builds'],
    ['npx --package=typescript tsc --noEmit', 'tests_builds'],
    ['npx -p typescript tsc --noEmit', 'tests_builds'],
    ['npx --package typescript tsc --noEmit', 'tests_builds'],
    ['npx playwright test tests/a.spec.ts', 'tests_builds'],
    ['npx jest', 'tests_builds'],
    ['pnpm exec vitest run', 'tests_builds'],
    ['pnpm dlx playwright test', 'tests_builds'],
    ['pnpm --silent exec -- vitest run', 'tests_builds'],
    ['yarn dlx vitest run', 'tests_builds'],
    ['bunx vitest run', 'tests_builds'],
    ['pnpx tsc --noEmit', 'tests_builds'],
    ['npx tsx scripts/check.ts', 'scripts'],
    ['npx npm test', 'tests_builds'],
    ['./node_modules/.bin/vitest run', 'tests_builds'],
    ['./node_modules/.bin/tsc --noEmit', 'tests_builds'],
  ];
  for (const [command, expected] of cases) assert.equal(commandFamily(command).label, expected, command);
  assert.equal(commandFamily('npx prettier --check .').label, 'unknown');
  assert.equal(commandFamily('npx --yes').label, 'unknown');
  assert.equal(commandFamily('pnpm exec').label, 'unknown');
});

test('compound and opaque shell syntax is not classified from its first word alone', () => {
  for (const command of ['git status && npm test', 'rg x | head', 'cd repo && git status']) {
    assert.equal(commandFamily(command).label, 'mixed', command);
  }
  for (const command of ['echo $(rm file)', 'echo `date`', 'for x in a; do git status; done', 'python3 <<\'PY\'\nprint(1)\nPY', 'echo "unterminated', '']) {
    assert.equal(commandFamily(command).label, 'unknown', command);
  }
  assert.equal(commandFamily(null).label, 'unknown');
  assert.equal(commandFamily('git status # do not run; npm test').label, 'unknown');
  assert.equal(commandFamily('mystery-command').rule, 'unrecognized_executable_or_action');
});

test('classifies error evidence without calling expected outcomes agent mistakes', () => {
  const cases: [string, string, string, boolean][] = [
    ['ls missing', 'ls: missing: No such file or directory\nCommand exited with code 2', 'missing_path', true],
    ['tool xyz', 'zsh: command not found: tool', 'command_unavailable', true],
    ['rg --wrong', 'error: unrecognized option --wrong', 'syntax_or_options', true],
    ['cat f', 'Permission denied', 'permissions', false],
    ['npm test', '3 tests failed', 'test_or_build_failure', false],
    ['rg foo .', 'Command exited with code 1', 'no_matches_possible', false],
    ['rg foo .', '(no output)\n\nCommand exited with code 1', 'no_matches_possible', false],
    ['git status', 'fatal: not a git repository (or any of the parent directories): .git', 'repository_state', true],
    ['curl x', 'Could not resolve host: x', 'network_or_auth', false],
    ['sleep 20', 'Command timed out after 10 seconds', 'timeout', false],
    ['npm test', 'Execution cancelled', 'cancellation', false],
    ['python3 x', 'opaque failure', 'unknown', false],
  ];
  for (const [command, output, expected, candidate] of cases) {
    const reason = failureReason(command, output, 'error');
    assert.equal(reason.label, expected, command);
    assert.equal(reason.potentiallyAvoidable, candidate, command);
    assert.ok(reason.rule.length > 0);
  }
});

test('test names and zero cancellation counters do not imply execution cancellation', () => {
  const output = '✖ refreshes after a cancelled command (4ms)\nℹ fail 2\nℹ cancelled 0\nCommand exited with code 1';
  assert.equal(failureReason('node --test test/*.ts', output, 'error').label, 'test_or_build_failure');
  assert.equal(failureReason('cd repo && npm test', output, 'error').label, 'test_or_build_failure');
  assert.equal(failureReason('npm test', 'Test Files  1 failed | 2 passed\nTests  2 failed', 'error').label, 'test_or_build_failure');
  assert.equal(failureReason('npx vitest run test/a.test.ts', 'Test Files  1 failed (1)\nTests  2 failed (2)', 'error').label, 'test_or_build_failure');
  assert.equal(failureReason('npx tsc --noEmit', 'src/a.ts(1,1): error TS2322: Type mismatch', 'error').label, 'test_or_build_failure');
  assert.equal(failureReason('echo x', 'There were 0 cancelled operations', 'error').label, 'unknown');
});

test('does not infer errors from successful output or overinterpret exit code one', () => {
  assert.equal(failureReason('rg foo .', 'No such file or directory', 'success').label, 'not_applicable');
  assert.equal(failureReason('npm test', 'Command exited with code 1', 'error').label, 'unknown');
  assert.equal(failureReason('rg foo . && npm test', 'Command exited with code 1', 'error').label, 'unknown');
  assert.equal(failureReason('rg foo .', 'Command exited with code 2', 'error').label, 'unknown');
  assert.equal(failureReason('echo "tests failed"', 'tests failed', 'error').label, 'unknown');
});
