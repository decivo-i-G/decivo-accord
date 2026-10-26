import { getConnections, globRoot, missedCodeFolders } from './connections'
import { getHealth, type HealthData } from './data'
import { type Overview, overviewOf } from './overview'
import type { Project } from './projects'
import { loadProjectProposals, type ProposalView } from './proposals'

export interface ProjectOverview {
  /** Undefined when Accord cannot read the project (no register, broken config). */
  overview?: Overview | undefined
  health?: HealthData | undefined
  proposals: ProposalView[]
  /**
   * Without a scanned code file: the folders with code that `surfaces.code.include` misses and where it
   * looks, so the sentence can name the plain cause ("Accord looks in src/, yours is in app/").
   */
  missed?: { found: string[]; include: string[]; configFile: string } | undefined
}

/** Everything the overview and the project list need about one project, read once. */
export async function loadOverview(project: Project): Promise<ProjectOverview> {
  const [health, proposals] = await Promise.all([
    getHealth(project).catch(() => undefined),
    loadProjectProposals(project).catch(() => [] as ProposalView[]),
  ])
  if (!health) return { proposals }
  const overview = overviewOf({ report: health.report, surfaces: health.surfaces, proposals })
  const missed =
    health.report.code.filesScanned === 0
      ? await getConnections(project).then(
          ({ code, configFile }) => {
            const found = missedCodeFolders(code)
            const include = [...new Set(code.include.map(globRoot))].filter(Boolean)
            return found.length > 0 && include.length > 0 ? { found, include, configFile } : undefined
          },
          () => undefined,
        )
      : undefined
  return { overview, health, proposals, missed }
}
