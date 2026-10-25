import { EpisodeError } from '../domain/errors.ts';
import { classifyEpisode } from './classify.ts';
import type { ProviderPort } from './provider.ts';

export const EPISODE_USAGE = `Episode commands:
  node src/cli.ts episode classify <session.jsonl> --from <entry-id> --at <user-entry-id>

Submits one Jev classification request for the explicitly selected episode.
The provider comes from JEV_PROVIDER (typesafe, openrouter) and its credential from
TYPESAFE_API_KEY or OPENROUTER_API_KEY. Selected episode evidence is sent unredacted.

JSON only on stdout. Exit codes: 0 classified, 1 fatal/invocation error.
`;

export interface EpisodeCliDependencies {
  providers: Record<string, ProviderPort>;
  env?: Record<string, string | undefined>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  now?: () => number;
}

interface ClassifyArguments { file: string; from: string; at: string }

function parseClassify(args: string[]): ClassifyArguments {
  let file: string | undefined;
  let from: string | undefined;
  let at: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === '--from' || argument === '--at') {
      const name = argument === '--from' ? 'from' : 'at';
      const value = args[index + 1];
      if (value === undefined || value === '' || value.startsWith('--')) throw new EpisodeError('invalid_arguments', argument);
      if (name === 'from') {
        if (from !== undefined) throw new EpisodeError('invalid_arguments', argument);
        from = value;
      } else {
        if (at !== undefined) throw new EpisodeError('invalid_arguments', argument);
        at = value;
      }
      index++;
    } else if (argument.startsWith('--')) {
      throw new EpisodeError('invalid_arguments', 'unknown option');
    } else {
      if (file !== undefined) throw new EpisodeError('invalid_arguments', 'unexpected positional argument');
      file = argument;
    }
  }
  if (file === undefined || file === '' || from === undefined || at === undefined) {
    throw new EpisodeError('invalid_arguments', 'expected a session file, --from and --at');
  }
  return { file, from, at };
}

// Fixed, content-free diagnostics: the code plus a non-sensitive detail only.
function diagnostic(error: unknown): string {
  if (error instanceof EpisodeError) {
    return `episode ${error.code}${error.detail === undefined ? '' : ` (${error.detail})`}`;
  }
  return 'episode unexpected_failure';
}

export async function runEpisodeCommand(args: string[], dependencies: EpisodeCliDependencies): Promise<number> {
  const stdout = dependencies.stdout ?? (text => process.stdout.write(text));
  const stderr = dependencies.stderr ?? (text => process.stderr.write(text));
  if (args.includes('--help') || args.includes('-h')) {
    stdout(EPISODE_USAGE);
    return 0;
  }
  if (args[0] !== 'classify') {
    stderr(diagnostic(new EpisodeError('invalid_arguments', 'expected the classify command')) + '\n');
    return 1;
  }
  try {
    const parsed = parseClassify(args.slice(1));
    const report = await classifyEpisode({
      ...parsed,
      env: dependencies.env ?? process.env,
      providers: dependencies.providers,
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      onProviderResolved: provider => stderr(`provider=${provider.name} model=${provider.model}\n`),
    });
    stdout(JSON.stringify(report, null, 2) + '\n');
    return 0;
  } catch (error) {
    stderr(diagnostic(error) + '\n');
    return 1;
  }
}
