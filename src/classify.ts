import type { BashCall } from './bash.ts';

export const CLASSIFIER_VERSION = 'bash-rules-v2';
export interface Family { label: string; rule: string; segmentFamilies: string[] }
export interface Reason { label: string; rule: string; potentiallyAvoidable: boolean }

// A conservative splitter, NOT a shell interpreter. Opaque constructs stay unknown.
// Quoted delimiters are text; only unquoted separators create command segments.
function segments(command: string): string[][] | null {
  if (/\$\(|`|<<|[{}]/.test(command)) return null;
  const result: string[][] = [];
  let words: string[] = [], word = '', quote = '', escaped = false;
  const endWord = () => { if (word) words.push(word); word = ''; };
  const endSegment = () => { endWord(); if (words.length) result.push(words); words = []; };
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (escaped) { if (char !== '\n') word += char; escaped = false; continue; }
    if (char === '\\' && quote !== "'") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ''; else word += char; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#' && !word) return null;
    if (char === '&' && /[<>]/.test(command[index - 1] ?? '')) { word += char; continue; }
    if (';&|\n'.includes(char)) { endSegment(); continue; }
    if (char === '(' || char === ')') return null;
    if (/\s/.test(char)) endWord(); else word += char;
  }
  if (quote || escaped) return null;
  endSegment();
  return result;
}
// Transparent command wrappers are skipped so the wrapped executable, not the
// launcher, determines the command purpose. Option-like arguments are skipped;
// only known value-taking options consume the following word.
function wrapperOptions(args: string[], start: number): number {
  let index = start;
  while (index < args.length) {
    const arg = args[index]!;
    if (arg === '--') return index - start + 1;
    if (!arg.startsWith('-')) return index - start;
    index += arg === '-p' || arg === '--package' ? 2 : 1;
  }
  return index - start;
}
function wrappedCommand(words: string[], start: number): { exe: string; args: string[] } {
  let index = start;
  for (;;) {
    const exe = (words[index] ?? '').split('/').at(-1) ?? '';
    const args = words.slice(index + 1);
    let target = -1;
    if (['npx', 'bunx', 'pnpx'].includes(exe)) {
      target = index + 1 + wrapperOptions(args, 0);
    } else if (['pnpm', 'yarn', 'bun'].includes(exe)) {
      const action = args.findIndex(arg => arg === 'exec' || arg === 'dlx');
      if (action >= 0) target = index + action + 2 + wrapperOptions(args, action + 1);
    }
    if (target < 0 || target >= words.length) return { exe, args };
    index = target;
  }
}
function familyFor(words: string[]): string {
  let i = 0;
  while (/^[A-Za-z_]\w*=/.test(words[i] ?? '')) i++;
  if (words[i] === 'env') { i++; while (/^[A-Za-z_]\w*=/.test(words[i] ?? '')) i++; }
  const { exe, args } = wrappedCommand(words, i);
  if (['rg', 'grep', 'egrep', 'fgrep', 'ag'].includes(exe)) return 'text_search';
  if (['ls', 'find', 'fd', 'tree', 'du', 'stat'].includes(exe)) return 'file_discovery';
  if (['cat', 'sed', 'head', 'tail', 'less', 'wc'].includes(exe)) return 'file_reading';
  if (['mkdir', 'cp', 'mv', 'rm', 'touch', 'chmod', 'ln', 'rmdir'].includes(exe)) return 'file_operations';
  if (exe === 'git') return 'git';
  if (['curl', 'wget', 'ssh', 'scp', 'rsync', 'gh', 'glab'].includes(exe)) return 'network';
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(exe)) {
    const action = args.find(a => !a.startsWith('-'));
    if (['install', 'i', 'add', 'remove', 'uninstall', 'update', 'audit', 'ci'].includes(action ?? '')) return 'package_management';
    if (['test', 'build', 'check', 'lint', 'typecheck', 'vitest', 'jest', 'tsc'].includes(action ?? '') ||
      (action === 'run' && /^(test(?::.*)?|build(?::.*)?|check|lint|typecheck)$/.test(args[args.indexOf('run') + 1] ?? ''))) return 'tests_builds';
    return 'unknown';
  }
  if (['pytest', 'vitest', 'jest', 'playwright', 'tsc', 'make', 'cmake', 'xcodebuild', 'swift', 'dotnet', 'cargo', 'go', 'mvn', 'gradle'].includes(exe)) {
    if (['swift', 'dotnet', 'cargo', 'go'].includes(exe) && !args.some(a => ['test', 'build', 'check', 'run'].includes(a))) return 'unknown';
    return 'tests_builds';
  }
  if (['pip', 'pip3', 'brew'].includes(exe)) return 'package_management';
  if ((exe === 'node' && args.includes('--test')) ||
    (/^python[\d.]*$/.test(exe) && args[0] === '-m' && ['pytest', 'unittest'].includes(args[1]))) return 'tests_builds';
  if (/^(python[\d.]*|node|ruby|perl|tsx)$/.test(exe)) return 'scripts';
  if (['pwd', 'cd', 'which', 'command', 'uname', 'printenv', 'export'].includes(exe)) return 'environment';
  if (['echo', 'printf', 'sleep', 'true', 'false', 'date'].includes(exe)) return 'shell_utilities';
  return 'unknown';
}
export function commandFamily(command: string | null): Family {
  const parsed = command ? segments(command) : null;
  if (!parsed?.length || parsed.some(words => ['if', 'then', 'else', 'fi', 'for', 'while', 'do', 'done', 'case', 'function', '!'].includes(words[0]))) {
    return { label: 'unknown', rule: 'opaque_or_missing_shell_structure', segmentFamilies: [] };
  }
  const families = parsed.map(familyFor);
  const unique = [...new Set(families)];
  return { label: unique.length === 1 ? unique[0] : 'mixed',
    rule: unique.length === 1 && unique[0] === 'unknown' ? 'unrecognized_executable_or_action' :
      parsed.length === 1 ? 'recognized_executable_and_action' : 'all_shell_segments_considered', segmentFamilies: families };
}
export function failureReason(command: string | null, output: string, outcome: BashCall['outcome']): Reason {
  const reason = (label: string, rule: string, potentiallyAvoidable = false): Reason => ({ label, rule, potentiallyAvoidable });
  if (outcome !== 'error') return reason('not_applicable', 'requires_tool_error_flag');
  if (/^\s*(?:error:\s*)?(?:(?:command(?: execution)?|execution|operation|tool (?:execution|call)) (?:was )?)?(?:cancelled|canceled|aborted)[.!]?\s*$/im.test(output)) {
    return reason('cancellation', 'explicit_execution_cancellation_line');
  }
  const rules: [RegExp, string, string, boolean][] = [
    [/command not found|not recognized as an internal|(?:sh|bash|zsh):.*: not found/i, 'command_unavailable', 'missing_executable_text', true],
    [/no such file or directory|cannot (?:access|stat)|pathspec .*did not match/i, 'missing_path', 'missing_path_text', true],
    [/fatal: not a git repository/i, 'repository_state', 'not_a_git_repository_text', true],
    [/unrecognized (?:option|argument)|unknown (?:option|argument)|invalid option|unexpected argument|syntax error|unterminated quoted|unexpected token/i, 'syntax_or_options', 'syntax_or_option_text', true],
    [/permission denied|operation not permitted/i, 'permissions', 'permission_text', false],
    [/timed? out|timeout.*exceeded|exceeded.*timeout/i, 'timeout', 'timeout_text', false],
    [/could not resolve|connection refused|authentication failed|http[^\n]*(?:401|403|429|5\d\d)|rate limit/i, 'network_or_auth', 'network_or_auth_text', false],
  ];
  for (const [pattern, label, rule, candidate] of rules) if (pattern.test(output)) return reason(label, rule, candidate);
  const family = commandFamily(command);
  if (family.label === 'text_search' && family.segmentFamilies.length === 1 &&
    /^\s*(?:\(no output\)\s*)?(?:Command|Process) exited with code 1\s*$/i.test(output)) return reason('no_matches_possible', 'search_only_exit_one');
  if (family.segmentFamilies.includes('tests_builds') &&
    /tests? failed|failed.*tests?|(?:Test Files|Tests)\s+\d+\s+failed|build failed|error TS\d|error CS\d|compilation failed|\bFAIL\s+\S|^\s*(?:ℹ\s*)?fail\s+[1-9]\d*\b/im.test(output)) {
    return reason('test_or_build_failure', 'test_build_command_and_failure_text');
  }
  return reason('unknown', 'insufficient_or_ambiguous_evidence');
}
export function classify(call: BashCall) {
  return { kind: 'heuristic', version: CLASSIFIER_VERSION, family: commandFamily(call.command),
    failure: failureReason(call.command, call.output, call.outcome) };
}
