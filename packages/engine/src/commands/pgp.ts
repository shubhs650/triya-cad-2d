// The user alias file (M3-10, FR-C4) in AutoCAD's acad.pgp syntax (AutoCAD 2024 Help, "To Create
// Command Aliases"): one `alias,*command` per line, `;` starting a comment. Its aliases override
// the default acad.pgp table (`ALIASES`), as the "User Defined Command Aliases" section at the
// end of acad.pgp overrides the lines above it; a later line for the same alias wins.
// External command lines (`NOTEPAD,START NOTEPAD,1,*File to edit: ,`) cannot run in a browser and
// are reported, not kept.
import type { CommandRegistry } from './command';

export interface AliasFileProblem {
  /** The line, from 1. */
  readonly line: number;
  readonly message: string;
}

export interface AliasFile {
  /** Alias to command, both upper case; the command may start with `-` (its dash form). */
  readonly aliases: Readonly<Record<string, string>>;
  /** The line each alias was last defined on, for `aliasFileProblems`. */
  readonly lines: Readonly<Record<string, number>>;
  readonly problems: readonly AliasFileProblem[];
}

/** Reads a pgp file's alias lines. */
export function parseAliasFile(text: string): AliasFile {
  const aliases: Record<string, string> = {};
  const lines: Record<string, number> = {};
  const problems: AliasFileProblem[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const semi = raw.indexOf(';');
    const body = (semi >= 0 ? raw.slice(0, semi) : raw).trim();
    if (body === '') return;
    const comma = body.indexOf(',');
    if (comma < 0) {
      problems.push({ line, message: 'Not an alias: write alias,*command (with a comma).' });
      return;
    }
    const alias = body.slice(0, comma).trim().toUpperCase();
    const rest = body.slice(comma + 1).trim();
    if (!rest.startsWith('*')) {
      problems.push({
        line,
        message: 'External commands cannot run in Triya; an alias needs * before its command.',
      });
      return;
    }
    const command = rest.slice(1).replace(/,\s*$/, '').trim().toUpperCase();
    if (alias === '') problems.push({ line, message: 'There is no alias before the comma.' });
    else if (/\s/.test(alias)) problems.push({ line, message: 'An alias cannot hold a space.' });
    else if (command === '') problems.push({ line, message: 'There is no command after the *.' });
    else if (/[\s,]/.test(command))
      problems.push({ line, message: 'A command name cannot hold a space or a comma.' });
    else {
      aliases[alias] = command;
      lines[alias] = line;
    }
  });
  return { aliases, lines, problems };
}

/**
 * What the drafter is told of the aliases a file keeps (the lines `parseAliasFile` could not
 * read aside): commands Triya does not have (the alias is kept and answers "Unknown command", as
 * in AutoCAD), dash forms a command lacks, and aliases a command name hides (AutoCAD looks up
 * command names before aliases: "Command Search Order").
 */
export function aliasFileProblems(file: AliasFile, registry: CommandRegistry): AliasFileProblem[] {
  const out: AliasFileProblem[] = [...file.problems];
  for (const [alias, command] of Object.entries(file.aliases)) {
    const line = file.lines[alias] ?? 0;
    const name = command.startsWith('-') ? command.slice(1) : command;
    const def = registry.get(name);
    if (registry.get(alias)) {
      out.push({
        line,
        message: `${alias} is a command name, which comes first: the alias is never used.`,
      });
    } else if (!def) out.push({ line, message: `${name} is not a command.` });
    else if (command.startsWith('-') && !def.dashVariant)
      out.push({ line, message: `${name} has no -${name} form.` });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Aliases as pgp lines, padded as acad.pgp pads them. */
export function formatAliasFile(aliases: Readonly<Record<string, string>>): string {
  return Object.entries(aliases)
    .map(([alias, command]) => `${`${alias},`.padEnd(8)} *${command}\n`)
    .join('');
}
