import { findProject } from './projects'
import { inboxCounts, loadProjectInbox } from './proposals'

/** What the sidebar and the project switcher show about a project at a glance: one number. */
export interface Glance {
  slug: string
  /** Open decisions (needs you and safe to adopt): it reaches 0 at inbox zero. */
  open: number
}

export async function glanceOf(slug: string): Promise<Glance> {
  const project = findProject(slug)
  if (!project) return { slug, open: 0 }
  const inbox = await loadProjectInbox(project).catch(() => undefined)
  return { slug, open: inboxCounts(inbox?.proposals ?? []).open }
}
