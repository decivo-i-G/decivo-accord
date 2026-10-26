#!/usr/bin/env node
import { isAbsolute, join } from 'node:path'
import { Argument, Command, Option } from 'commander'
import {
  applyCommand,
  checkCommand,
  DEFAULT_REGISTER_DIR,
  designCommand,
  diffCommand,
  explainOwnerCommand,
  exportCommand,
  figmaCommand,
  ingestCommand,
  initCommand,
  penCommand,
  reportCommand,
} from './commands.js'
import { explainError } from './errors.js'
import type { InitSource } from './init.js'
import { detectLang, translator } from './messages.js'
import { accordVersion } from './report-payload.js'

const t = translator(detectLang())
const print = (text: string) => process.stdout.write(`${text}\n`)
// `accord diff | head`: the reader may stop early. That is not an error; end quietly with what was read.
for (const stream of [process.stdout, process.stderr])
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(process.exitCode ?? 0)
    throw error
  })

const program = new Command()
  .name('accord')
  .description(t('help.accord'))
  .version(accordVersion(), '-v, --version', t('help.version'))
  .helpOption('-h, --help', t('help.help'))
  .addHelpCommand(false)
  .option('-C, --root <dir>', t('help.root'), '.')
  .option('-r, --register <dir>', t('help.register'), DEFAULT_REGISTER_DIR)
  .showHelpAfterError()

const common = () => program.opts<{ root: string; register: string }>()
const run = (fn: () => Promise<number>) => async () => {
  try {
    process.exitCode = await fn()
  } catch (error) {
    const { root, register } = common()
    const registerDir = isAbsolute(register) ? register : join(root, register)
    process.stderr.write(
      `${explainError(error, t, { registerDir, debug: Boolean(process.env.ACCORD_DEBUG) })}\n`,
    )
    process.exitCode = 2
  }
}

const json = () => new Option('--json', t('help.json')).default(false)
const dryRun = () => new Option('--dry-run', t('help.dryRun')).default(false)

program
  .command('init')
  .description(t('help.init'))
  .option('--force', t('help.init.force'), false)
  .addOption(dryRun())
  .addOption(new Option('--from <source>', t('help.init.from')).choices(['code', 'tokens', 'design']))
  .option('--figma <path...>', t('help.init.figma'))
  .option('--mode <name>', t('help.init.mode'))
  .action((o: { force: boolean; dryRun: boolean; from?: InitSource; figma?: string[]; mode?: string }) =>
    run(() => initCommand({ ...common(), ...o }, t, print))(),
  )

program
  .command('diff')
  .description(t('help.diff'))
  .addOption(json())
  .option('--limit <n>', t('help.diff.limit'), (v) => Math.max(1, Number.parseInt(v, 10) || 15), 15)
  .action((o: { json: boolean; limit: number }) => run(() => diffCommand({ ...common(), ...o }, t, print))())

program
  .command('check')
  .description(t('help.check'))
  .argument('[paths...]', t('help.check.paths'))
  .option('--diff <file>', t('help.check.diff'))
  .addOption(json())
  .addOption(new Option('--format <format>', t('help.format')).choices(['text', 'json', 'github']))
  .action((paths: string[], o: { diff?: string; json: boolean; format?: 'text' | 'json' | 'github' }) =>
    run(() => checkCommand({ ...common(), paths, ...o }, print))(),
  )

program
  .command('export')
  .description(t('help.export'))
  .option('--check', t('help.export.check'), false)
  .action((o: { check: boolean }) => run(() => exportCommand({ ...common(), ...o }, t, print))())

program
  .command('ingest')
  .description(t('help.ingest'))
  .argument('<bundle>', t('help.ingest.bundle'))
  .addOption(json())
  .option('--write', t('help.ingest.write'), false)
  .option('--branch', t('help.ingest.branch'), false)
  .action((bundle: string, o: { json: boolean; write: boolean; branch: boolean }) =>
    run(() => ingestCommand({ ...common(), bundle, ...o }, t, print))(),
  )

program
  .command('apply')
  .description(t('help.apply'))
  .option('--resolution <file>', t('help.apply.resolution'))
  .option('--proposal <id>', t('help.apply.proposal'))
  .addOption(new Option('--option <option>', t('help.apply.option')).choices(['adopt', 'reset', 'reject']))
  .option('--by <name>', t('help.apply.by'))
  .option('--note <text>', t('help.apply.note'))
  .addOption(dryRun())
  .option('--branch', t('help.apply.branch'), false)
  .option('--push', t('help.apply.push'), false)
  .addOption(json())
  .action(
    (o: {
      resolution?: string
      proposal?: string
      option?: 'adopt' | 'reset' | 'reject'
      by?: string
      note?: string
      dryRun: boolean
      branch: boolean
      push: boolean
      json: boolean
    }) => run(() => applyCommand({ ...common(), ...o }, t, print))(),
  )

program
  .command('design')
  .description(t('help.design'))
  .addArgument(new Argument('<action>', t('help.action')).choices(['status', 'reset', 'lock']))
  .requiredOption('--mirror <dir>', t('help.design.mirror'))
  .addOption(json())
  .action((action: 'status' | 'reset' | 'lock', o: { mirror: string; json: boolean }) =>
    run(() => designCommand({ ...common(), action, ...o }, t, print))(),
  )

program
  .command('pen')
  .description(t('help.pen'))
  .addArgument(new Argument('<action>', t('help.action')).choices(['status', 'lock', 'propose']))
  .option('--write', t('help.propose.write'), false)
  .option('--branch', t('help.propose.branch'), false)
  .addOption(json())
  .action((action: 'status' | 'lock' | 'propose', o: { json: boolean; write: boolean; branch: boolean }) =>
    run(() => penCommand({ ...common(), action, ...o }, t, print))(),
  )

program
  .command('figma')
  .description(t('help.figma'))
  .addArgument(new Argument('<action>', t('help.action')).choices(['status', 'lock', 'propose']))
  .option('--file <path...>', t('help.figma.file'))
  .option('--mode <name>', t('help.figma.mode'))
  .option('--write', t('help.propose.write'), false)
  .option('--branch', t('help.propose.branch'), false)
  .addOption(json())
  .action(
    (
      action: 'status' | 'lock' | 'propose',
      o: { json: boolean; file?: string[]; mode?: string; write: boolean; branch: boolean },
    ) => run(() => figmaCommand({ ...common(), action, ...o }, t, print))(),
  )

program
  .command('report')
  .description(t('help.report'))
  .option('--url <url>', t('help.report.url'))
  .option('--token-env <name>', t('help.report.tokenEnv'), 'ACCORD_REPORT_TOKEN')
  .option('--commit <sha>', t('help.report.commit'))
  .option('--branch <name>', t('help.report.branch'))
  .option('--default-branch <name>', t('help.report.defaultBranch'))
  .addOption(
    new Option('--source <source>', t('help.report.source')).choices(['action', 'cli']).default('cli'),
  )
  .addOption(new Option('--json', t('help.report.json')).default(false))
  .action(
    (o: {
      url?: string
      tokenEnv: string
      commit?: string
      branch?: string
      defaultBranch?: string
      source: 'action' | 'cli'
      json: boolean
    }) => run(() => reportCommand({ ...common(), ...o }, t, print))(),
  )

program
  .command('explain-owner')
  .description(t('help.explainOwner'))
  .argument('<path>', t('help.explainOwner.path'))
  .action((path: string) => run(() => explainOwnerCommand({ ...common(), path }, print))())

await program.parseAsync()
