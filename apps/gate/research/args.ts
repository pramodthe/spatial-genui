// Strict flag parsing for the bench scripts. Accepts `--name value` and `--name=value`, rejects
// unknown flags and flags missing a value: on a billed benchmark CLI a mistyped flag must fail
// loudly instead of silently falling back to "run everything".

export type CliSpec = { values?: string[]; booleans?: string[]; usage: string };
export type Cli = { flags: Record<string, string | undefined>; booleans: Set<string>; positional: string[] };

export function parseCli(argv: string[], spec: CliSpec): Cli {
  const values = new Set(spec.values ?? []);
  const booleanNames = new Set(spec.booleans ?? []);
  const flags: Record<string, string | undefined> = {};
  const booleans = new Set<string>();
  const positional: string[] = [];
  const fail = (message: string): never => {
    console.error(`${message}\nUsage: ${spec.usage}`);
    process.exit(1);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = arg.slice(2, eq < 0 ? undefined : eq);
    if (booleanNames.has(name)) {
      if (eq >= 0) fail(`--${name} takes no value`);
      booleans.add(name);
      continue;
    }
    if (!values.has(name)) fail(`Unknown flag --${name}`);
    let value: string | undefined;
    if (eq >= 0) {
      value = arg.slice(eq + 1);
    } else {
      value = argv[i + 1];
      i++;
    }
    if (value === undefined || value === '' || value.startsWith('--')) fail(`--${name} needs a value`);
    flags[name] = value;
  }
  return { flags, booleans, positional };
}
