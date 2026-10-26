import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { findProject } from '@/lib/projects'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ project: string }>
}) {
  if (!findProject((await params).project)) notFound()
  return children
}
