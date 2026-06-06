/**
 * feedreel command-line interface (commander).
 *
 * Commands:
 *   prepare [--date]   fetch + dedup → cache/items/<date>.json
 *   render  [--date]   read the skill-written script → output/<date>.mp4 + .txt
 *
 * The editorial work (script + title + description + hashtags) is done by the
 * "feedreel" Claude Code skill, which writes cache/scripts/<date>.json between
 * these two commands.
 */
import { Command } from 'commander';
import { today } from './util';
import { log } from './log';
import { prepare, render } from './pipeline/orchestrate';

/** `prepare` command: fetch + dedup the items and write the JSON cache. */
async function cmdPrepare(opts: { date?: string }): Promise<number> {
  const res = await prepare({ date: opts.date });
  // eslint-disable-next-line no-console
  console.log(`\n${res.count} item(s) ready for ${res.date}\n  → ${res.itemsFile}\n`);
  return 0;
}

/** `render` command: build the video + caption from the skill-written script. */
async function cmdRender(opts: { date?: string }): Promise<number> {
  const res = await render({ date: opts.date });
  const hashtags = res.hashtags.length > 0 ? `\n\n${res.hashtags.join(' ')}` : '';
  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      `✅ Video for ${res.date}`,
      `   → ${res.outputFile}`,
      `   → ${res.textFile}`,
      '',
      '──── copy-paste for social ────',
      res.title,
      '',
      res.description + hashtags,
      '───────────────────────────────',
      '',
    ].join('\n'),
  );
  return 0;
}

/** Builds the commander program. */
function buildProgram(): Command {
  const program = new Command();
  program
    .name('feedreel')
    .description('Local-first generator of one daily short video.')
    .showHelpAfterError();

  program
    .command('prepare')
    .description('Fetches and deduplicates the items, writes the JSON cache.')
    .option('-d, --date <date>', 'target date (YYYY-MM-DD), defaults to today', today())
    .action(async (opts: { date?: string }) => {
      process.exitCode = await cmdPrepare(opts);
    });

  program
    .command('render')
    .description('Builds the video + caption from the skill-written script.')
    .option('-d, --date <date>', 'target date (YYYY-MM-DD), defaults to today', today())
    .action(async (opts: { date?: string }) => {
      process.exitCode = await cmdRender(opts);
    });

  return program;
}

/** Entry point: parses the arguments, runs, and handles errors cleanly. */
export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (e) {
    log.error(String(e));
    process.exitCode = 1;
  }
}

// Direct launch (tsx src/cli.ts ...).
void main();
