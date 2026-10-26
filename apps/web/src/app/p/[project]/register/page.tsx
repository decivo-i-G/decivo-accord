import { cssVariableName } from '@decivo/accord-cli'
import { matchPath } from '@decivo/accord-core'
import { permanentRedirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { EmptyState } from '@/components/empty-state'
import { Component, Layers, Scale } from '@/components/icons'
import { ShortcutSheet } from '@/components/inbox-keys'
import { PageHeader } from '@/components/page-header'
import { PanelLayout } from '@/components/panel'
import styles from '@/components/register.module.css'
import { ComponentTable } from '@/components/register-components'
import {
  AgentsBox,
  ComponentInspector,
  ComponentOverview,
  RuleInspector,
  RuleList,
  RuleOverview,
  TokenInspector,
  TokenOverview,
} from '@/components/register-inspectors'
import { PendingInspector, SelectionProvider } from '@/components/register-selection'
import { TokenTable } from '@/components/register-tokens'
import { Shell } from '@/components/shell'
import { Tabs } from '@/components/tabs'
import { getConnections, missedCodeFolders } from '@/lib/connections'
import { fileExists, getAgentExample, getHealth } from '@/lib/data'
import { loadRegisterOnce, registerMetadata } from '@/lib/page-meta'
import { findProject, registerDirOf } from '@/lib/projects'
import { loadProjectProposals } from '@/lib/proposals'
import {
  legacyRegisterHref,
  REGISTER_TABS,
  type RegisterTab,
  readRegisterState,
  registerHref,
} from '@/lib/register-href'
import { registerModes } from '@/lib/register-modes'
import {
  type CodeLink,
  codeUseOf,
  componentRow,
  openChangesByToken,
  tokenRows,
  visibleTokens,
} from '@/lib/register-view'
import { projectHref } from '@/lib/routes'

export const dynamic = 'force-dynamic'
export const generateMetadata = registerMetadata

const TAB_ICON: Record<RegisterTab, ReactNode> = {
  tokens: <Layers aria-hidden="true" />,
  components: <Component aria-hidden="true" />,
  rules: <Scale aria-hidden="true" />,
}

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const project = findProject((await params).project)
  if (!project) return null
  const query = await searchParams
  const base = `/p/${project.slug}/register`
  // `?tab=decisions` is the rules tab's old name; the word belongs to the inbox now.
  const legacy = legacyRegisterHref(base, query)
  if (legacy) permanentRedirect(legacy)
  const state = readRegisterState(query)
  const { tab } = state
  const t = await getTranslations('register')
  const register = await loadRegisterOnce(registerDirOf(project))
  // The register's own text (rules, why, descriptions) is marked with its language where the UI speaks another.
  const textLang = register.config.language
  const lang = textLang && textLang.split('-')[0] !== (await getLocale()).split('-')[0] ? textLang : undefined
  const listHref = registerHref(base, { tab, q: state.q, filter: state.filter })

  const tokens = tokenRows(register, cssVariableName)
  const contracts = [...register.components.values()]
  const decisions = [...register.decisions.values()].filter((d) => d.status === 'active')
  const counts: Record<RegisterTab, number> = {
    tokens: tokens.length,
    components: contracts.length,
    rules: decisions.length,
  }

  let main: ReactNode
  let inspector: ReactNode
  let selectedLabel: string | undefined

  if (tab === 'tokens') {
    const token = state.item ? register.tokens.get(state.item) : undefined
    const shown = token && visibleTokens(register).includes(token) ? token : undefined
    const openChanges = openChangesByToken(await loadProjectProposals(project).catch(() => []))
    const openCounts = Object.fromEntries(
      Object.entries(openChanges).map(([path, list]) => [path, list.length]),
    )
    const proposalsBase = projectHref(project.slug, 'decisions')
    const modes = await registerModes(project, register, registerDirOf(project)).catch(() => undefined)
    main = (
      <TokenTable
        key={state.filter ?? 'all'}
        rows={tokens}
        base={base}
        selected={shown?.path}
        initialQuery={state.q}
        initialType={state.filter}
        open={openCounts}
        modes={
          modes && { source: modes.source, main: modes.main, others: modes.others, values: modes.values }
        }
      />
    )
    if (shown) {
      const health = await getHealth(project).catch(() => undefined)
      const code = codeUseOf(health?.report.code, shown.path)
      // Uses are not counted because code sits in folders Accord does not check: name them, one click adds them.
      const missed =
        code?.status === 'defined'
          ? await getConnections(project).then(
              ({ code: surface, configFile }) => {
                const found = missedCodeFolders(surface)
                return found.length > 0 ? { found, configFile } : undefined
              },
              () => undefined,
            )
          : undefined
      selectedLabel = shown.path
      inspector = (
        <TokenInspector
          register={register}
          token={shown}
          cssVar={cssVariableName(shown)}
          code={code}
          missed={missed}
          project={project.slug}
          open={openChanges[shown.path] ?? []}
          modes={modes?.covered.includes(shown.path) ? modes : undefined}
          proposalsBase={proposalsBase}
          base={base}
          backHref={listHref}
          lang={lang}
        />
      )
    } else if (tokens.length > 0) {
      inspector = (
        <TokenOverview
          open={Object.keys(openChanges).length}
          proposalsBase={proposalsBase}
          backHref={listHref}
        />
      )
    }
  } else if (tab === 'components') {
    const links = new Map<string, CodeLink>(
      await Promise.all(
        contracts.map(
          async (c) =>
            [
              c.name,
              c.mappings.code
                ? (await fileExists(project.root, c.mappings.code.path))
                  ? 'inSync'
                  : 'missing'
                : 'noMapping',
            ] as const,
        ),
      ),
    )
    const rows = contracts.map((c) => componentRow(c, links.get(c.name) ?? 'noMapping'))
    // `?component=button` finds `Button`: names are matched without case, the exact one first.
    const wanted = state.item?.toLowerCase()
    const contract = state.item
      ? (register.components.get(state.item) ?? contracts.find((c) => c.name.toLowerCase() === wanted))
      : undefined
    main = (
      <ComponentTable
        rows={rows}
        base={base}
        selected={contract?.name}
        initialQuery={state.q}
        initialStatus={state.filter}
      />
    )
    if (contract) {
      selectedLabel = contract.name
      inspector = (
        <ComponentInspector
          register={register}
          contract={contract}
          code={links.get(contract.name) ?? 'noMapping'}
          base={base}
          backHref={listHref}
          lang={lang}
        />
      )
    } else if (contracts.length > 0) {
      inspector = <ComponentOverview backHref={listHref} />
    }
  } else {
    const paths = visibleTokens(register).map((tk) => tk.path)
    const coveredBy = (id: string) => {
      const d = register.decisions.get(id)
      return d ? paths.filter((p) => d.scope.some((s) => matchPath(s, `tokens.${p}`))) : []
    }
    const decision = state.item ? decisions.find((d) => d.id === state.item) : undefined
    const example = await getAgentExample(project).catch(() => undefined)
    main =
      decisions.length === 0 ? (
        <EmptyState title={t('rules.empty.title')} text={t('rules.empty.text')} />
      ) : (
        <>
          <RuleList decisions={decisions} selected={decision?.id} base={base} lang={lang} />
          {example && <AgentsBox example={example} proposalsHref={projectHref(project.slug, 'decisions')} />}
        </>
      )
    if (decision) {
      selectedLabel = decision.rule
      inspector = (
        <RuleInspector
          decision={decision}
          covered={coveredBy(decision.id)}
          base={base}
          backHref={listHref}
          lang={lang}
        />
      )
    } else if (decisions.length > 0) {
      inspector = <RuleOverview backHref={listHref} />
    }
  }

  return (
    <Shell
      project={project}
      active="register"
      // A token's path is a value and is set in mono in the breadcrumb, as in the list and the title.
      item={selectedLabel ? { label: selectedLabel, code: tab === 'tokens' } : t(`tabs.${tab}`)}
      flush
    >
      <SelectionProvider>
        <PanelLayout
          open={Boolean(selectedLabel)}
          inspector={
            tab === 'tokens' && inspector ? (
              <PendingInspector selected={selectedLabel} backHref={listHref}>
                {inspector}
              </PendingInspector>
            ) : (
              inspector
            )
          }
          heading={t('title')}
        >
          <PageHeader title={t('title')} compact />
          <div className={styles.tabs}>
            <Tabs
              label={t('tabs.label')}
              current={tab}
              items={REGISTER_TABS.map((id) => ({
                id,
                label: t(`tabs.${id}`),
                href: registerHref(base, { tab: id }),
                icon: TAB_ICON[id],
                count: { value: counts[id], label: t('tabs.count', { count: counts[id] }) },
              }))}
            />
          </div>
          {main}
          {tab !== 'rules' && <ShortcutSheet screen="register" />}
        </PanelLayout>
      </SelectionProvider>
    </Shell>
  )
}
