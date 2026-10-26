import { z } from 'zod'

/**
 * Repositories the app shows. In production they come from GitHub App installations (database);
 * for local development and the pilot they are listed in ACCORD_PROJECTS:
 *   [{ "slug": "decivo", "name": "decivo-i-G/decivo", "root": "/path/to/decivo", "register": "/path/to/.accord" }]
 */
const ProjectSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  root: z.string(),
  register: z.string().optional(),
  branch: z.string().default('main'),
})

export type Project = z.infer<typeof ProjectSchema>

export function listProjects(env: Record<string, string | undefined> = process.env): Project[] {
  const raw = env.ACCORD_PROJECTS
  if (!raw) return []
  const parsed = z.array(ProjectSchema).safeParse(JSON.parse(raw))
  if (!parsed.success) throw new Error(`ACCORD_PROJECTS is invalid: ${parsed.error.message}`)
  return parsed.data
}

export function findProject(slug: string, env?: Record<string, string | undefined>): Project | undefined {
  return listProjects(env).find((p) => p.slug === slug)
}

/** Register directory of a project: explicit, else `<root>/.accord`. */
export const registerDirOf = (project: Project) => project.register ?? `${project.root}/.accord`
