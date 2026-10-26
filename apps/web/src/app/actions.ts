'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { THEME_COOKIE, themeFrom } from '@/lib/theme'

/** Remember the interface language for a year. */
export async function setLocale(formData: FormData) {
  const locale = formData.get('locale') === 'en' ? 'en' : 'de'
  ;(await cookies()).set('locale', locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  revalidatePath('/', 'layout')
}

/** Remember Light (default), Dark or System for a year, like the language. */
export async function setTheme(formData: FormData) {
  const raw = formData.get('theme')
  const theme = themeFrom(typeof raw === 'string' ? raw : undefined)
  const jar = await cookies()
  if (theme === 'light') jar.delete(THEME_COOKIE)
  else jar.set(THEME_COOKIE, theme, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  revalidatePath('/', 'layout')
}

/** Switch a surface (Figma, Pencil, Claude Design) on or off (local mode: `accord.config.yaml`). */
export async function toggleTool(formData: FormData) {
  const { findProject } = await import('@/lib/projects')
  const { isToolId, setToolEnabled } = await import('@/lib/connections')
  const { forgetHealth } = await import('@/lib/data')
  const project = findProject(String(formData.get('project') ?? ''))
  const tool = formData.get('tool')
  if (!project || !isToolId(tool)) return
  await setToolEnabled(project, tool, formData.get('enabled') === 'true')
  // Health reads `enabled` from the config; without this it would show the old state for up to a minute.
  forgetHealth(project.slug)
  revalidatePath('/', 'layout')
}

/**
 * Lets Accord also look for code in the folders it found outside `surfaces.code.include` (local mode:
 * `accord.config.yaml`). The folders are worked out on the server again; the form only names the project.
 * Returns the folders it added and how many code files Accord now checks.
 */
export async function includeCode(formData: FormData): Promise<{ folders: string[]; files: number }> {
  const { findProject } = await import('@/lib/projects')
  const { includeCodeFolders } = await import('@/lib/connections')
  const { forgetHealth, getHealth } = await import('@/lib/data')
  const project = findProject(String(formData.get('project') ?? ''))
  if (!project) return { folders: [], files: 0 }
  const folders = await includeCodeFolders(project)
  forgetHealth(project.slug)
  // The new count for the confirmation ("Accord prüft jetzt 42 Dateien"); the page re-reads the same cache.
  const files = await getHealth(project).then(
    (h) => h.report.code.filesScanned,
    () => 0,
  )
  revalidatePath('/', 'layout')
  return { folders, files }
}

/** Undoes `includeCode`: Accord stops looking in these folders again (the toast's "Undo"). */
export async function excludeCode(formData: FormData): Promise<string[]> {
  const { findProject } = await import('@/lib/projects')
  const { excludeCodeFolders } = await import('@/lib/connections')
  const { forgetHealth } = await import('@/lib/data')
  const project = findProject(String(formData.get('project') ?? ''))
  if (!project) return []
  const folders = formData.getAll('folder').map(String)
  const removed = await excludeCodeFolders(project, folders)
  forgetHealth(project.slug)
  revalidatePath('/', 'layout')
  return removed
}
