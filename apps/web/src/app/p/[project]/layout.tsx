import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { NoRegister } from '@/components/no-register'
import { RegisterBroken } from '@/components/register-broken'
import { findProject } from '@/lib/projects'
import { registerState } from '@/lib/register-state'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ project: string }>
}) {
  const project = findProject((await params).project)
  if (!project) notFound()
  // Without a readable register no page of the project has anything sound to show: all of them say the
  // same thing and how to get there.
  const register = await registerState(project)
  if (register.state === 'none') return <NoRegister project={project} />
  if (register.state === 'broken') return <RegisterBroken project={project} problems={register.problems} />
  return children
}
