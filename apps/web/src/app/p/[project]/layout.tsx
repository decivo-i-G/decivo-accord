import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { NoRegister } from '@/components/no-register'
import { findProject, hasRegister } from '@/lib/projects'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ project: string }>
}) {
  const project = findProject((await params).project)
  if (!project) notFound()
  // Without a register no page of the project has anything to show; all of them say how to start.
  if (!hasRegister(project)) return <NoRegister project={project} />
  return children
}
