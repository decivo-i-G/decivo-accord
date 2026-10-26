'use server'

import { cssVariableName } from '@decivo/accord-cli'
import { loadRegister } from '@decivo/accord-core/node'
import { getTranslations } from 'next-intl/server'
import { glanceOf } from '@/lib/glance'
import type { PaletteItem } from '@/lib/palette'
import { findProject, listProjects, type Project, registerDirOf } from '@/lib/projects'
import { loadInbox, type Message } from '@/lib/proposals'
import { registerHref } from '@/lib/register-href'
import { tokenRows } from '@/lib/register-view'
import { decisionHref } from '@/lib/routes'

/**
 * The searchable content of one project for the command palette, loaded when the palette opens
 * (not on every page view). Only what the pages already show, as plain data with deep links.
 */
export async function paletteItems(slug: string): Promise<PaletteItem[]> {
  const project = findProject(slug)
  if (!project) return []
  const tp = await getTranslations('proposals')
  const say = (m: Message) => tp(m.key as Parameters<typeof tp>[0], m.values as never)
  const [inbox, register] = await Promise.all([
    loadInbox(project).catch(() => undefined),
    registerItems(project),
  ])
  const items: PaletteItem[] = []

  for (const p of inbox?.proposals ?? []) {
    const state = p.decision ? tp(`state.${p.decision.option}`) : tp(`state.${p.group}`)
    const needsYou = p.group === 'needsYou'
    items.push({
      group: 'proposals',
      key: `proposal:${p.id}`,
      label: say(p.title),
      // "Braucht dich" is the chip; the second line does not say it again.
      detail: needsYou ? tp(`tool.${p.tool}`) : `${tp(`tool.${p.tool}`)} · ${state}`,
      href: decisionHref(slug, p.id),
      badge: needsYou ? tp('group.needsYou') : undefined,
      keywords: p.id.toLowerCase(),
    })
  }
  return [...items, ...register]
}

/** A project's tokens, components and active rules, each linking into its register. */
async function registerItems(project: Project): Promise<PaletteItem[]> {
  const register = await loadRegister(registerDirOf(project)).catch(() => undefined)
  const items: PaletteItem[] = []
  if (register) {
    const base = `/p/${project.slug}/register`
    for (const row of tokenRows(register, cssVariableName)) {
      items.push({
        group: 'tokens',
        key: `token:${row.path}`,
        label: row.path,
        alias: row.alias,
        detail: row.value,
        href: registerHref(base, { tab: 'tokens', item: row.path }),
        swatch: row.preview.kind === 'color' ? row.preview.css : undefined,
        keywords: row.haystack,
        mono: true,
      })
    }
    for (const c of register.components.values()) {
      items.push({
        group: 'components',
        key: `component:${c.name}`,
        label: c.name,
        detail: c.mappings.code?.path,
        href: registerHref(base, { tab: 'components', item: c.name }),
      })
    }
    for (const d of register.decisions.values()) {
      if (d.status !== 'active') continue
      items.push({
        group: 'decisions',
        key: `decision:${d.id}`,
        // The rule's name; its code (D-002) is only something to search by, as in the register's details.
        label: d.rule,
        detail: d.why,
        keywords: d.id.toLowerCase(),
        href: registerHref(base, { tab: 'rules', item: d.id }),
      })
    }
  }
  return items
}

/**
 * The tokens, components and rules of every project except the current one, for the palette's
 * "In anderen Projekten" group. Each hit names its project as the second line.
 */
export async function elsewhereItems(current?: string): Promise<PaletteItem[]> {
  const others = listProjects().filter((p) => p.slug !== current)
  const lists = await Promise.all(
    others.map(async (project) =>
      (await registerItems(project)).map((item) => ({
        ...item,
        group: 'elsewhere' as const,
        key: `elsewhere:${project.slug}:${item.key}`,
        alias: undefined,
        detail: project.name,
        keywords: [item.keywords, item.alias, item.detail?.toLowerCase()].filter(Boolean).join(' '),
      })),
    ),
  )
  return lists.flat()
}

/** The open decisions of every project, for the project switcher (loaded when it opens). */
export async function projectGlances() {
  return Promise.all(listProjects().map((p) => glanceOf(p.slug)))
}
