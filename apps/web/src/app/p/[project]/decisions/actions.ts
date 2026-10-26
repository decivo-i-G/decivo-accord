'use server'

import { revalidatePath } from 'next/cache'
import type { DecideResult, NamedColor } from '@/lib/decide'
import type { Option } from '@/lib/proposals'

export interface DecideRequest {
  project: string
  id: string
  option: Option
  by: string
  note?: string | undefined
  names?: NamedColor[] | undefined
  confirmed?: boolean | undefined
}

const OPTIONS: Option[] = ['adopt', 'reset', 'reject']

/** Adopt, reset or reject a stored proposal through Accord's own resolution, plan and write. */
export async function decide(request: DecideRequest): Promise<DecideResult> {
  const { findProject } = await import('@/lib/projects')
  const { decideProposal } = await import('@/lib/decide')
  const project = findProject(String(request.project ?? ''))
  if (!project || typeof request.id !== 'string' || !OPTIONS.includes(request.option))
    return { ok: false, code: 'invalid_input' }
  const names = Array.isArray(request.names)
    ? request.names
        .filter((n) => typeof n?.value === 'string' && typeof n?.token === 'string')
        .map((n) => ({ value: n.value, token: n.token.slice(0, 200) }))
    : undefined
  const result = await decideProposal(project, {
    id: request.id,
    option: request.option,
    by: String(request.by ?? '').slice(0, 200),
    note:
      typeof request.note === 'string' && request.note.trim()
        ? request.note.trim().slice(0, 2000)
        : undefined,
    names,
    confirmed: request.confirmed === true,
  })
  if (result.ok) {
    // The register changed: Health and the sidebar score must not show the cached report from before.
    const { forgetHealth } = await import('@/lib/data')
    forgetHealth(project.slug)
    revalidatePath(`/p/${project.slug}`, 'layout')
  }
  return result
}

/** Take a decision back within a few minutes. */
export async function undoDecide(projectSlug: string, undo: string): Promise<boolean> {
  const { findProject } = await import('@/lib/projects')
  const { undoDecision } = await import('@/lib/decide')
  const project = findProject(String(projectSlug ?? ''))
  if (!project || typeof undo !== 'string') return false
  const done = await undoDecision(project, undo)
  if (done) {
    const { forgetHealth } = await import('@/lib/data')
    forgetHealth(project.slug)
    revalidatePath(`/p/${project.slug}`, 'layout')
  }
  return done
}

/** Take back the newest decision on a proposal (the decided view's undo), within the same few minutes. */
export async function undoLatest(projectSlug: string, proposal: string): Promise<boolean> {
  const { findProject } = await import('@/lib/projects')
  const { undoOf } = await import('@/lib/decide')
  const project = findProject(String(projectSlug ?? ''))
  if (!project || typeof proposal !== 'string') return false
  const undo = undoOf(project, proposal)
  return undo ? undoDecide(project.slug, undo) : false
}
