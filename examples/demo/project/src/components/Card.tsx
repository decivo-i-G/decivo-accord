import type { ReactNode } from 'react'

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      style={{
        background: 'var(--surface)',
        color: 'var(--text)',
        borderRadius: 'var(--radius-card)',
        padding: 'var(--space-4)',
        // Copied from a mock-up instead of using the token:
        borderTop: '4px solid #3c6681',
      }}
    >
      <h2>{title}</h2>
      {children}
    </section>
  )
}
