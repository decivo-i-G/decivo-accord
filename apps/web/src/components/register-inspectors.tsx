import type { ComponentContract, Decision, Register, Token } from '@decivo/accord-core'
import { resolveOwner } from '@decivo/accord-core'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import type { AgentExample } from '@/lib/data'
import { modeName } from '@/lib/mode-name'
import { registerHref } from '@/lib/register-href'
import type { ModeView } from '@/lib/register-modes'
import {
  aliasChain,
  anatomyTree,
  type CodeLink,
  type CodeUse,
  decisionReason,
  decisionsFor,
  type OpenChange,
  ownerView,
  previewOf,
  scopeLabel,
  valueText,
} from '@/lib/register-view'
import { CopyValue } from './copy-button'
import { ChevronRight, Frame, ToolIcon } from './icons'
import { IncludeCodeButton } from './include-code-button'
import { Notice } from './notice'
import { Inspector, InspectorSection, PropertyList } from './panel'
import styles from './register.module.css'
import { AliasChip, BreakablePath, OwnerChip, TokenPreview, TypeIcon } from './register-parts'
import { StatusChip, type Tone } from './status-chip'
import { Swatch } from './swatch'

type Contract = ComponentContract & { file: string }
type DecisionEntry = Decision & { file: string }

/**
 * Text written in the register (rule names, why, fix hints, descriptions) is in the register's language,
 * which may differ from the interface's: `lang` marks it so screen readers pronounce it right.
 */
type Lang = string | undefined

/** The quiet "Details" disclosure: configuration and lookups that the default view leaves out. */
function More({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className={styles.more}>
      <summary>
        <ChevronRight aria-hidden="true" />
        {summary}
      </summary>
      <div className={styles.moreBody}>{children}</div>
    </details>
  )
}

/** Where the owner comes from (a rule, the group, the default) and the exact `explain-owner` line. */
async function OwnerSource({ register, path }: { register: Register; path: string }) {
  const t = await getTranslations('register')
  const view = ownerView(register, path)
  // A rule's pattern in words ("Tokens der Gruppe blue"); the pattern itself stays in the explain block.
  const reasonValues =
    view.reason.key === 'rule' || view.reason.key === 'component'
      ? (() => {
          const label = scopeLabel(String(view.reason.values.pattern ?? ''))
          return { ...view.reason.values, target: t(`rules.scopeLabel.${label.key}`, label.values) }
        })()
      : view.reason.values
  return (
    <div className={styles.ownerBlock}>
      <p className={styles.fine}>{t(`token.ownerReason.${view.reason.key}`, reasonValues)}</p>
      <p className={styles.fine}>{t('token.ownerFixed')}</p>
      <details className={styles.disclosure}>
        <summary>{t('token.explain')}</summary>
        <pre className={styles.explain}>
          <code>
            {`accord explain-owner ${path}\n`}
            {view.explain}
          </code>
        </pre>
      </details>
    </div>
  )
}

/** A rule in short: its name (a link), its why and how it reaches this token. */
async function RuleMini({
  decision,
  href,
  reason,
  lang,
}: {
  decision: DecisionEntry
  href: string
  /** Why it applies here: named on the entry, or through a scope pattern. */
  reason?: ReturnType<typeof decisionReason>
  lang: Lang
}) {
  const t = await getTranslations('register')
  return (
    <li className={styles.miniDecision}>
      <Link href={href} className={styles.miniLink} lang={lang}>
        {decision.rule}
      </Link>
      <span className={styles.miniWhy} lang={lang}>
        <span className="visually-hidden">{t('rules.why')}: </span>
        {decision.why}
      </span>
      {reason && (
        <span className={styles.fine}>
          {reason.kind === 'named' ? (
            t('token.ruleNamed')
          ) : (
            <span title={reason.pattern}>
              {t('token.ruleVia', {
                target: (() => {
                  const label = scopeLabel(reason.pattern)
                  return t(`rules.scopeLabel.${label.key}`, label.values)
                })(),
              })}
            </span>
          )}
        </span>
      )}
    </li>
  )
}

// --- Token ----------------------------------------------------------------------------------------

/**
 * One token, default view first: its value, the CSS variable to copy, an open decision, its modes, who
 * decides and its use in code. Where the owner comes from, references, rules, the names on the
 * surfaces and the file sit under "Details".
 */
export async function TokenInspector({
  register,
  token,
  cssVar,
  code,
  open = [],
  proposalsBase,
  base,
  backHref,
  modes,
  missed,
  project,
  lang,
}: {
  register: Register
  token: Token
  cssVar: string
  code: CodeUse | undefined
  /** Folders with code that Accord does not check (why uses are not counted), and its config file. */
  missed?: { found: string[]; configFile: string } | undefined
  project: string
  /** Open proposals that touch this token. */
  open?: OpenChange[] | undefined
  proposalsBase?: string | undefined
  base: string
  backHref: string
  /** Figma's modes, when Figma defines this token and has more than one mode. */
  modes?: ModeView | undefined
  lang?: Lang
}) {
  const t = await getTranslations('register')
  const tokenHref = (path: string) => registerHref(base, { tab: 'tokens', item: path })
  const preview = previewOf(token)
  const value = valueText(token.type, token.value)
  const chain = aliasChain(register, token.path)
  const aliasedBy = [...register.tokens.values()].filter((o) => o.aliasOf === token.path && !o.inheritedFrom)
  const rules = decisionsFor(register, `tokens.${token.path}`, token.accord?.decisions)
  const components = [...register.components.values()].filter((c) => c.tokens.includes(token.path))
  const ids = token.accord?.ids ?? {}
  const surfaces = (
    [
      ['figma', 'figma', ids.figma],
      ['pen', 'pen', ids.pen],
      ['claudeDesign', 'claude_design', ids.claudeDesign],
    ] as const
  ).filter(([, , id]) => id)
  const group = token.path.split('.')[0] ?? token.path
  const owner = ownerView(register, `tokens.${token.path}`).owner

  return (
    <Inspector
      label={t('detail')}
      meta={
        <span className={styles.metaLine}>
          <TypeIcon type={token.type} />
          {t('token.meta', { type: t(`types.${token.type}`), group })}
        </span>
      }
      title={token.path}
      titleFont="mono"
      backHref={backHref}
      backLabel={t('back')}
    >
      {token.deprecated && (
        <Notice tone="warning">
          {typeof token.deprecated === 'string' ? (
            <span lang={lang}>{t('token.deprecatedWhy', { reason: token.deprecated })}</span>
          ) : (
            t('token.deprecated')
          )}
        </Notice>
      )}

      <div className={styles.hero}>
        {preview.kind !== 'none' && <TokenPreview preview={preview} size="lg" sample={t('token.sample')} />}
        <div className={styles.heroValue}>
          <code
            className={styles.heroCode}
            style={preview.kind === 'fontFamily' ? { fontFamily: preview.css } : undefined}
          >
            {value}
          </code>
          {token.aliasOf && (
            <AliasChip
              target={token.aliasOf}
              href={tokenHref(token.aliasOf)}
              label={t('tokens.alias', { target: token.aliasOf })}
              color={preview.kind === 'color' ? preview.css : undefined}
            />
          )}
          {preview.kind === 'color' && preview.alpha < 1 && (
            <span className={styles.fine}>
              {t('token.alpha', { value: Math.round(preview.alpha * 100) })}
            </span>
          )}
        </div>
      </div>

      <PropertyList
        rows={[
          {
            label: t('token.props.variable'),
            value: (
              <CopyValue
                value={cssVar}
                label={t('tokens.copyVariable')}
                className={`${styles.copyVar} ${styles.copyVarInline}`}
                textClassName={styles.variable}
              />
            ),
          },
        ]}
      />

      {token.description && (
        <p className={styles.description} lang={lang}>
          {token.description}
        </p>
      )}

      {open.length > 0 && proposalsBase && (
        <InspectorSection title={t('token.openTitle', { count: open.length })}>
          <OpenList open={open} proposalsBase={proposalsBase} />
        </InspectorSection>
      )}

      {modes && (
        <InspectorSection title={t('token.modesTitle')}>
          <ModePair
            token={token}
            modes={modes}
            value={value}
            color={preview.kind === 'color' ? preview.css : undefined}
          />
        </InspectorSection>
      )}

      <InspectorSection title={t('token.ownerTitle')}>
        <div className={styles.ownerHead}>
          <OwnerChip owner={owner} label={t(`owners.${owner}`)} />
        </div>
        <p>{t(`token.ownerSentence.${owner}`)}</p>
      </InspectorSection>

      <InspectorSection title={t('token.codeTitle')}>
        {code ? (
          <CodeUseBlock code={code} cssVar={cssVar} missed={missed} project={project} />
        ) : (
          <p className={styles.fine}>{t('token.code.notScanned')}</p>
        )}
      </InspectorSection>

      <More summary={t('detail')}>
        <PropertyList rows={[{ label: t('token.props.file'), value: <BreakablePath path={token.file} /> }]} />

        <InspectorSection title={t('token.ownerSourceTitle')}>
          <OwnerSource register={register} path={`tokens.${token.path}`} />
        </InspectorSection>

        <InspectorSection title={t('token.rulesTitle')}>
          {rules.length === 0 ? (
            <p className={styles.fine}>{t('token.noRules')}</p>
          ) : (
            <ul className={styles.miniList}>
              {rules.map((d) => (
                <RuleMini
                  key={d.id}
                  decision={d}
                  href={registerHref(base, { tab: 'rules', item: d.id })}
                  reason={decisionReason(d, `tokens.${token.path}`, token.accord?.decisions)}
                  lang={lang}
                />
              ))}
            </ul>
          )}
        </InspectorSection>

        {(chain.length > 0 || aliasedBy.length > 0) && (
          <InspectorSection title={t('token.aliasTitle')}>
            {chain.length > 0 && (
              <>
                <p className={styles.fine}>{t('token.aliasText')}</p>
                <ol className={styles.chain}>
                  <li>
                    <span className={styles.chainSelf}>{token.path}</span>
                  </li>
                  {chain.map((path) => (
                    <li key={path}>
                      <AliasChip
                        target={path}
                        href={tokenHref(path)}
                        label={t('tokens.alias', { target: path })}
                        color={preview.kind === 'color' ? preview.css : undefined}
                      />
                    </li>
                  ))}
                  <li>
                    <code className={styles.chainValue}>{value}</code>
                  </li>
                </ol>
              </>
            )}
            {aliasedBy.length > 0 && (
              <>
                <p className={styles.fine}>{t('token.aliasedBy', { count: aliasedBy.length })}</p>
                <ul className={styles.chipList}>
                  {aliasedBy.slice(0, 24).map((o) => (
                    <li key={o.path}>
                      <Link href={tokenHref(o.path)} className={styles.tokenChip} scroll={false}>
                        {o.path}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </InspectorSection>
        )}

        <InspectorSection title={t('token.surfacesTitle')}>
          <ul className={styles.surfaceList}>
            <li className={styles.surfaceRow}>
              <span className={styles.surfaceName}>
                <ToolIcon tool="code" />
                {t('token.surfaces.code')}
              </span>
              <code>{cssVar}</code>
            </li>
            {surfaces.map(([key, tool, id]) => (
              <li key={key} className={styles.surfaceRow}>
                <span className={styles.surfaceName}>
                  <ToolIcon tool={tool} />
                  {t(`token.surfaces.${key}`)}
                </span>
                <code>{id}</code>
              </li>
            ))}
          </ul>
          {surfaces.length === 0 && <p className={styles.fine}>{t('token.surfacesDefault')}</p>}
        </InspectorSection>

        {components.length > 0 && (
          <InspectorSection title={t('token.componentsTitle')}>
            <ul className={styles.chipList}>
              {components.map((c) => (
                <li key={c.name}>
                  <Link
                    href={registerHref(base, { tab: 'components', item: c.name })}
                    className={styles.tokenChip}
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </InspectorSection>
        )}
      </More>
    </Inspector>
  )
}

/**
 * The token's value in each mode, side by side like Figma's variables panel, and one sentence on where
 * the other modes live: in the register (its contexts), or only in Figma.
 */
async function ModePair({
  token,
  modes,
  value,
  color,
}: {
  token: Token
  modes: ModeView
  value: string
  color: string | undefined
}) {
  const t = await getTranslations('register')
  const own = modes.values[token.path] ?? {}
  const others = modes.others.map((m) => modeName(t, m)).join(', ')
  const main = modeName(t, modes.main)
  const note = modes.source === 'register' ? 'token.modesNoteRegister' : 'token.modesNote'
  return (
    <>
      <dl className={styles.modePair}>
        <div className={styles.modeCell}>
          <dt className={styles.modeName}>{main}</dt>
          <dd className={styles.modeValue}>
            {color && <Swatch color={color} size="sm" />}
            <code>{value}</code>
          </dd>
        </div>
        {modes.others.map((mode) => {
          const v = own[mode]
          return (
            <div key={mode} className={styles.modeCell}>
              <dt className={styles.modeName}>{modeName(t, mode)}</dt>
              <dd className={styles.modeValue}>
                {v ? (
                  <>
                    {v.color && <Swatch color={v.color} size="sm" />}
                    <code>{v.text}</code>
                  </>
                ) : (
                  <span className={styles.fine}>{t('tokens.modes.same', { mode: main })}</span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
      <p className={styles.fine}>
        {t(`${note}.${Object.keys(own).length > 0 ? 'differs' : 'same'}`, { other: others, main })}
      </p>
    </>
  )
}

const TOOL_KEY: Record<OpenChange['tool'], string> = {
  figma: 'figma',
  pen: 'pen',
  'claude-design': 'claudeDesign',
  code: 'code',
}

/** Open proposals touching a token: from which tool, what they want, and a link to decide. */
async function OpenList({ open, proposalsBase }: { open: OpenChange[]; proposalsBase: string }) {
  const t = await getTranslations('register')
  return (
    <ul className={styles.openList}>
      {open.map((o) => (
        <li key={o.id} className={styles.openItem}>
          <span className={styles.surfaceName}>
            <ToolIcon tool={o.tool === 'claude-design' ? 'claude_design' : o.tool} />
            {t('token.openFrom', { tool: t(`token.tools.${TOOL_KEY[o.tool]}`) })}
          </span>
          <span className={styles.openChange}>
            {o.kind !== 'remove' && o.after && /^#|^rgb|^hsl|^oklch/.test(o.after) && (
              <Swatch color={o.after} size="sm" />
            )}
            {t(`token.openKind.${o.kind}`, { before: o.before ?? '', after: o.after ?? '' })}
          </span>
          <Link href={`${proposalsBase}?id=${encodeURIComponent(o.id)}`} className={styles.openLink}>
            {t('token.openLink')}
          </Link>
        </li>
      ))}
    </ul>
  )
}

const CODE_STATUS_TONE: Record<CodeUse['status'], Tone> = {
  used: 'success',
  unused: 'neutral',
  missing: 'warning',
  drift: 'warning',
  defined: 'info',
}

async function CodeUseBlock({
  code,
  cssVar,
  missed,
  project,
}: {
  code: CodeUse
  cssVar: string
  missed?: { found: string[]; configFile: string } | undefined
  project: string
}) {
  const t = await getTranslations('register')
  const tc = await getTranslations('connections')
  const format = await getFormatter()
  // Token names and CSS variables inside a sentence are code, set in mono like everywhere else.
  const tags = { code: (chunks: ReactNode) => <code>{chunks}</code> }
  const folders = missed
    ? format.list(
        missed.found.map((f) => `${f}/`),
        { type: 'conjunction' },
      )
    : ''
  if (code.status === 'defined' && missed)
    return (
      <div className={styles.codeUse}>
        <p>{t('token.code.notChecked', { folders })}</p>
        <IncludeCodeButton
          project={project}
          configFile={missed.configFile}
          label={tc('include', { folders })}
          className={styles.actionLink}
        />
      </div>
    )
  const sentence: Record<CodeUse['status'], ReactNode> = {
    used: t.rich('token.code.used', { count: code.uses, variable: cssVar, ...tags }),
    unused: t.rich('token.code.unused', { variable: cssVar, ...tags }),
    missing: t.rich('token.code.missing', { variable: cssVar, ...tags }),
    drift: t('token.code.drift'),
    defined: t.rich('token.code.defined', { variable: cssVar, ...tags }),
  }
  return (
    <div className={styles.codeUse}>
      <StatusChip tone={CODE_STATUS_TONE[code.status]}>{t(`token.codeStatus.${code.status}`)}</StatusChip>
      <p>{sentence[code.status]}</p>
      {code.drift && (
        <p className={styles.fine}>
          {t('token.code.driftValues', {
            register: code.drift.register ?? t('token.code.notSet'),
            code: code.drift.code ?? t('token.code.notSet'),
          })}
        </p>
      )}
      {code.hardValueCount > 0 && (
        <>
          <p className={styles.fine}>{t('token.code.hard', { count: code.hardValueCount })}</p>
          <ul className={styles.fileList}>
            {code.hardValues.map((h) => (
              <li key={`${h.file}:${h.line}:${h.raw}`}>
                <code>
                  {h.file}:{h.line}
                </code>
                <code className={styles.hardRaw}>{h.raw}</code>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * No token chosen: one sentence on what to do, and, when tokens wait for a decision, one link to the
 * inbox. The list itself already shows types, groups and counts; the inbox is the only place to decide.
 */
export async function TokenOverview({
  open,
  proposalsBase,
  backHref,
}: {
  /** Tokens with an open decision. */
  open: number
  proposalsBase: string
  backHref: string
}) {
  const t = await getTranslations('register')
  return (
    <Inspector label={t('detail')} title={t('tokenOverview.title')} backHref={backHref} backLabel={t('back')}>
      <p>{t('tokenOverview.text')}</p>
      {open > 0 && (
        <p>
          <Link href={proposalsBase} className={styles.openLink}>
            {t('tokenOverview.open', { count: open })}
          </Link>
        </p>
      )}
    </Inspector>
  )
}

// --- Component ------------------------------------------------------------------------------------

export async function ComponentInspector({
  register,
  contract,
  code,
  base,
  backHref,
  lang,
}: {
  register: Register
  contract: Contract
  code: CodeLink
  base: string
  backHref: string
  lang?: Lang
}) {
  const t = await getTranslations('register')
  const props = Object.entries(contract.props)
  const slots = Object.entries(contract.slots)
  const owners = (['variants', 'props', 'states', 'slots'] as const).map(
    (field) => [field, resolveOwner(register, `components.${contract.name}.${field}`).owner] as const,
  )
  const mapping = contract.mappings
  // A mapped Figma component opens in Figma; the node id is how Figma's URLs spell it (`1-23`).
  const figmaUrl = mapping.figma
    ? `https://www.figma.com/design/${encodeURIComponent(mapping.figma.file_key)}${
        mapping.figma.node_id ? `?node-id=${encodeURIComponent(mapping.figma.node_id.replace(':', '-'))}` : ''
      }`
    : undefined
  const designMappings = [
    ['figma', 'figma', mapping.figma ? (mapping.figma.node_id ?? mapping.figma.file_key) : undefined],
    ['pen', 'pen', mapping.pen?.path],
    ['claudeDesign', 'claude_design', mapping.claude_design?.path],
  ] as const
  const stories = mapping.code?.story ? [mapping.code.story].flat() : []

  return (
    <Inspector
      label={t('detail')}
      meta={
        <span className={styles.metaLine}>
          {t('component.meta', { status: t(`components.status.${contract.status}`) })}
        </span>
      }
      title={contract.name}
      backHref={backHref}
      backLabel={t('back')}
    >
      {(contract.status === 'deprecated' || contract.deprecated) && (
        <Notice tone="warning">
          {typeof contract.deprecated === 'string' ? (
            <span lang={lang}>{contract.deprecated}</span>
          ) : (
            t('component.deprecated')
          )}
        </Notice>
      )}
      {contract.description && (
        <p className={styles.description} lang={lang}>
          {contract.description}
        </p>
      )}
      {contract.status === 'draft' && (
        <p className={styles.fine}>
          {t.rich('component.draftHint', {
            file: contract.file,
            code: (chunks) => <code>{chunks}</code>,
          })}
        </p>
      )}

      <InspectorSection title={t('component.variantsTitle')}>
        {Object.keys(contract.variants).length === 0 ? (
          <p className={styles.fine}>{t('component.variantsEmpty')}</p>
        ) : (
          <dl className={styles.variantList}>
            {Object.entries(contract.variants).map(([axis, options]) => (
              <div key={axis} className={styles.variantAxis}>
                <dt>{axis}</dt>
                <dd>
                  <ul className={styles.chipList}>
                    {options.map((o) => (
                      <li key={o} className={styles.option}>
                        {o}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </InspectorSection>

      <InspectorSection title={t('component.propsTitle')}>
        {props.length === 0 ? (
          <p className={styles.fine}>{t('component.propsEmpty')}</p>
        ) : (
          <div className={styles.propsWrap}>
            <table className={styles.propsTable}>
              <thead>
                <tr>
                  <th scope="col">{t('component.propColumns.name')}</th>
                  <th scope="col">{t('component.propColumns.type')}</th>
                  <th scope="col">{t('component.propColumns.default')}</th>
                </tr>
              </thead>
              <tbody>
                {props.map(([name, p]) => (
                  <tr key={name}>
                    <th scope="row">
                      <code>{name}</code>
                      {p.required && <span className={styles.required}>{t('component.required')}</span>}
                    </th>
                    <td>
                      {p.type === 'enum' && p.values ? (
                        <ul className={styles.chipList}>
                          {p.values.map((v) => (
                            <li key={v} className={styles.option}>
                              {v}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <code className={styles.propType}>{p.type}</code>
                      )}
                    </td>
                    <td>
                      {p.default === undefined ? (
                        <span className={styles.muted}>{t('component.noDefault')}</span>
                      ) : (
                        <code>{JSON.stringify(p.default)}</code>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </InspectorSection>

      {contract.states.length > 0 && (
        <InspectorSection title={t('component.statesTitle')}>
          <ul className={styles.chipList}>
            {contract.states.map((s) => (
              <li key={s} className={styles.option}>
                {s}
              </li>
            ))}
          </ul>
        </InspectorSection>
      )}

      {(contract.anatomy.length > 0 || slots.length > 0) && (
        <InspectorSection title={t('component.anatomyTitle')}>
          {contract.anatomy.length > 0 && (
            <ul className={styles.layers}>
              {anatomyTree(contract.anatomy).map((part) => (
                <li key={part.name} className={styles.layer} data-depth={part.depth}>
                  <Frame aria-hidden="true" />
                  <span>{part.name}</span>
                  {contract.slots[part.name] && (
                    <span className={styles.fine}>{t(`component.slot.${contract.slots[part.name]}`)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {slots.some(([name]) => !contract.anatomy.includes(name)) && (
            <p className={styles.fine}>{t('component.slotsTitle')}</p>
          )}
          {slots.some(([name]) => !contract.anatomy.includes(name)) && (
            <PropertyList
              rows={slots
                .filter(([name]) => !contract.anatomy.includes(name))
                .map(([name, need]) => ({ label: name, value: t(`component.slot.${need}`) }))}
            />
          )}
        </InspectorSection>
      )}

      {contract.a11y && (
        <InspectorSection title={t('component.a11yTitle')}>
          <PropertyList
            rows={[
              ...(contract.a11y.role
                ? [{ label: t('component.a11y.role'), value: <code>{contract.a11y.role}</code> }]
                : []),
              ...(contract.a11y.min_target
                ? [
                    {
                      label: t('component.a11y.minTarget'),
                      value: t('component.a11y.minTargetValue', { value: contract.a11y.min_target }),
                    },
                  ]
                : []),
              ...(contract.a11y.notes
                ? [
                    {
                      label: t('component.a11y.notes'),
                      value: <span lang={lang}>{contract.a11y.notes}</span>,
                    },
                  ]
                : []),
            ]}
          />
        </InspectorSection>
      )}

      <InspectorSection title={t('component.mappingTitle')}>
        <ul className={styles.surfaceList}>
          <li className={styles.surfaceRow}>
            <span className={styles.surfaceName}>
              <ToolIcon tool="code" />
              {t('token.surfaces.code')}
            </span>
            {mapping.code ? (
              <span className={styles.mappingValue}>
                <StatusChip tone={code === 'inSync' ? 'success' : 'warning'}>
                  {t(code === 'inSync' ? 'component.mapping.found' : 'component.mapping.missing')}
                </StatusChip>
              </span>
            ) : (
              <span className={styles.fine}>{t('component.mapping.none')}</span>
            )}
          </li>
          {designMappings.map(([key, tool, id]) => (
            <li key={key} className={styles.surfaceRow}>
              <span className={styles.surfaceName}>
                <ToolIcon tool={tool} />
                {t(`token.surfaces.${key}`)}
              </span>
              {key === 'figma' && figmaUrl ? (
                <a href={figmaUrl} className={styles.openLink} target="_blank" rel="noreferrer">
                  {t('component.mapping.openFigma')}
                </a>
              ) : id ? (
                <code>{id}</code>
              ) : (
                <span className={styles.fine}>{t('component.mapping.notConnected')}</span>
              )}
            </li>
          ))}
        </ul>
      </InspectorSection>

      <InspectorSection title={t('component.ownersTitle')}>
        <dl className={styles.ownerFields}>
          {owners.map(([field, owner]) => (
            <div key={field}>
              <dt>{t(`component.fields.${field}`)}</dt>
              <dd>
                <OwnerChip owner={owner} label={t(`owners.${owner}`)} />
              </dd>
            </div>
          ))}
        </dl>
        <p className={styles.fine}>{t('token.ownerFixed')}</p>
      </InspectorSection>

      {contract.tokens.length > 0 && (
        <InspectorSection title={t('component.tokensTitle')}>
          <ul className={styles.chipList}>
            {contract.tokens.map((path) => (
              <li key={path}>
                <Link href={registerHref(base, { tab: 'tokens', item: path })} className={styles.tokenChip}>
                  {path}
                </Link>
              </li>
            ))}
          </ul>
        </InspectorSection>
      )}

      {/* Files and exports are for developers: one quiet disclosure, closed by default. */}
      <More summary={t('rules.developers')}>
        <PropertyList
          rows={[
            ...(mapping.code
              ? [
                  { label: t('component.mapping.file'), value: <BreakablePath path={mapping.code.path} /> },
                  { label: t('component.mapping.export'), value: <code>{mapping.code.export}</code> },
                  ...stories.map((s) => ({ label: t('component.mapping.story'), value: <code>{s}</code> })),
                ]
              : []),
            { label: t('component.contractFile'), value: <BreakablePath path={contract.file} /> },
          ]}
        />
      </More>
    </Inspector>
  )
}

/** No component chosen: one sentence on what the inspector shows. */
export async function ComponentOverview({ backHref }: { backHref: string }) {
  const t = await getTranslations('register')
  return (
    <Inspector
      label={t('detail')}
      title={t('componentOverview.title')}
      backHref={backHref}
      backLabel={t('back')}
    >
      <p>{t('componentOverview.text')}</p>
    </Inspector>
  )
}

// --- Rules ----------------------------------------------------------------------------------------

/** How Accord checks a rule, as one sentence per check. */
function checkLines(decision: DecisionEntry, t: Awaited<ReturnType<typeof getTranslations<'register'>>>) {
  return decision.checks.map((c) => {
    if (c.type !== 'deterministic') return t('rules.check.model', { question: c.question })
    const r = c.rule
    if (r.kind === 'value_in_scale') {
      const label = scopeLabel(r.scale)
      const key = label.key === 'allTokens' || label.key === 'tokenGroup' ? label.key : 'raw'
      const values = key === 'raw' ? { pattern: r.scale } : label.values
      return t('rules.check.value_in_scale', { scale: t(`rules.scaleLabel.${key}`, values) })
    }
    if (r.kind === 'no_raw_values')
      return t('rules.check.no_raw_values', { types: r.types.map((x) => t(`types.${x}`)).join(', ') })
    return t('rules.check.min_contrast', {
      ratio: r.ratio,
      foreground: r.foreground,
      background: r.background,
    })
  })
}

/**
 * The rules as a plain list, one line each: the rule's name, then one quiet line with who decides,
 * where it applies and what a violation does. Why, fix, checks and the rule code live in the inspector.
 */
export async function RuleList({
  decisions,
  selected,
  base,
  lang,
}: {
  decisions: DecisionEntry[]
  selected?: string | undefined
  base: string
  lang?: Lang
}) {
  const t = await getTranslations('register')
  return (
    <ul className={styles.ruleList} aria-label={t('rules.listLabel')}>
      {decisions.map((d) => {
        const current = d.id === selected
        const scopes = d.scope.map((s) => {
          const label = scopeLabel(s)
          return t(`rules.scopeLabel.${label.key}`, label.values)
        })
        return (
          <li key={d.id} className={styles.ruleRow} data-current={current || undefined}>
            <Link
              href={registerHref(base, { tab: 'rules', item: d.id })}
              className={styles.ruleLink}
              aria-current={current ? 'true' : undefined}
              data-row-link=""
              scroll={false}
              lang={lang}
            >
              {d.rule}
            </Link>
            <span className={styles.ruleMeta}>
              <OwnerChip owner={d.owner} label={t('ownerLabel', { owner: t(`owners.${d.owner}`) })} />
              <span>{t('rules.scopeLine', { scope: scopes.join(', ') })}</span>
              <span>{t(`rules.levelHint.${d.level}`)}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export async function RuleInspector({
  decision,
  covered,
  base,
  backHref,
  lang,
}: {
  decision: DecisionEntry
  covered: string[]
  base: string
  backHref: string
  lang?: Lang
}) {
  const t = await getTranslations('register')
  const checks = checkLines(decision, t)
  const good = decision.examples?.good ?? []
  const bad = decision.examples?.bad ?? []
  return (
    <Inspector
      label={t('detail')}
      meta={<span className={styles.metaLine}>{t(`rules.levelHint.${decision.level}`)}</span>}
      title={decision.rule}
      heading={<span lang={lang}>{decision.rule}</span>}
      backHref={backHref}
      backLabel={t('back')}
    >
      <div className={styles.whyBlock}>
        <span className={styles.whyLabel}>{t('rules.why')}</span>
        <p lang={lang}>{decision.why}</p>
      </div>
      {decision.fix_hint && (
        <InspectorSection title={t('rules.fix')}>
          <p lang={lang}>{decision.fix_hint}</p>
        </InspectorSection>
      )}
      <PropertyList
        rows={[
          {
            label: t('rules.owner'),
            value: <OwnerChip owner={decision.owner} label={t(`owners.${decision.owner}`)} />,
          },
          {
            label: t('rules.scope'),
            value: (
              <ul className={styles.scopeList}>
                {decision.scope.map((s) => {
                  const label = scopeLabel(s)
                  return <li key={s}>{t(`rules.scopeLabel.${label.key}`, label.values)}</li>
                })}
              </ul>
            ),
          },
        ]}
      />
      {checks.length > 0 && (
        <InspectorSection title={t('rules.checksTitle')}>
          <ul className={styles.checkList}>
            {checks.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </InspectorSection>
      )}
      {(good.length > 0 || bad.length > 0) && (
        <InspectorSection title={t('rules.examplesTitle')}>
          <div className={styles.examples}>
            {good.map((e) => (
              <div key={`good-${e}`} className={styles.example} data-kind="good">
                <StatusChip tone="success">{t('rules.good')}</StatusChip>
                <pre>{e}</pre>
              </div>
            ))}
            {bad.map((e) => (
              <div key={`bad-${e}`} className={styles.example} data-kind="bad">
                <StatusChip tone="danger">{t('rules.bad')}</StatusChip>
                <pre>{e}</pre>
              </div>
            ))}
          </div>
        </InspectorSection>
      )}
      {covered.length > 0 && (
        <InspectorSection title={t('rules.coversTitle')}>
          <p className={styles.fine}>{t('rules.covers', { count: covered.length })}</p>
          <ul className={styles.chipList}>
            {covered.slice(0, 18).map((path) => (
              <li key={path}>
                <Link href={registerHref(base, { tab: 'tokens', item: path })} className={styles.tokenChip}>
                  {path}
                </Link>
              </li>
            ))}
            {covered.length > 18 && (
              <li className={styles.fine}>{t('rules.moreTokens', { count: covered.length - 18 })}</li>
            )}
          </ul>
        </InspectorSection>
      )}
      {/* Configuration (code, patterns, the file) stays out of the default view. */}
      <More summary={t('rules.developers')}>
        <PropertyList
          rows={[
            { label: t('rules.id'), value: <code>{decision.id}</code> },
            {
              label: t('rules.pattern'),
              value: (
                <ul className={styles.scopeList}>
                  {decision.scope.map((s) => (
                    <li key={s}>
                      <code className={styles.scope}>{s}</code>
                    </li>
                  ))}
                </ul>
              ),
            },
            { label: t('rules.file'), value: <BreakablePath path={decision.file} /> },
          ]}
        />
        {decision.supersedes && decision.supersedes.length > 0 && (
          <p className={styles.fine}>{t('rules.supersedes', { ids: decision.supersedes.join(', ') })}</p>
        )}
      </More>
    </Inspector>
  )
}

/** No rule chosen: one sentence on what the inspector shows. */
export async function RuleOverview({ backHref }: { backHref: string }) {
  const t = await getTranslations('register')
  return (
    <Inspector label={t('detail')} title={t('ruleOverview.title')} backHref={backHref} backLabel={t('back')}>
      <p>{t('ruleOverview.text')}</p>
    </Inspector>
  )
}

/**
 * The real `check_change` example for developers, folded: the same rules, read by agents. Configuration
 * stays out of the default view.
 */
export async function AgentsBox({
  example,
  proposalsHref,
}: {
  example: AgentExample
  proposalsHref: string
}) {
  const t = await getTranslations('register')
  return (
    <details className={`${styles.more} ${styles.agents}`}>
      <summary>
        <ChevronRight aria-hidden="true" />
        {t('agents.title')}
      </summary>
      <div className={styles.moreBody}>
        <p className={styles.fine}>{t('agents.lead')}</p>
        <p className={styles.agentsLabel}>{t('agents.example')}</p>
        <pre className={styles.agentsCode}>
          {example.call}
          {'\n→ '}
          {example.output.length > 0 ? example.output.join('\n  ') : t('agents.clean')}
        </pre>
        <p className={styles.fine}>
          {t('agents.generated')} <Link href={proposalsHref}>{t('agents.proposals')}</Link>
        </p>
      </div>
    </details>
  )
}
