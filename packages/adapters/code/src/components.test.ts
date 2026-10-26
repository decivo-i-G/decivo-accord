import { describe, expect, it } from 'vitest'
import { componentForVariants, readComponentModule } from './components.js'

const BUTTON = `
import { cva, type VariantProps } from "class-variance-authority"
const buttonVariants = cva("inline-flex", {
  variants: {
    variant: { default: "bg-primary", ghost: "hover:bg-muted", "icon-sm": "size-7" },
    size: { default: "h-8", sm: "h-7" },
  },
  defaultVariants: { variant: "default", size: "default" },
})
function Button(props: VariantProps<typeof buttonVariants>) { return <button /> }
export { Button, buttonVariants }
export function ButtonGroup() { return null }
export const useButton = () => null
`

describe('readComponentModule', () => {
  it('reads cva variants, defaults and PascalCase exports', () => {
    expect(readComponentModule(BUTTON, 'button.tsx')).toEqual({
      file: 'button.tsx',
      exports: ['Button', 'ButtonGroup'],
      variants: { buttonVariants: { variant: ['default', 'ghost', 'icon-sm'], size: ['default', 'sm'] } },
      defaults: { buttonVariants: { variant: 'default', size: 'default' } },
    })
  })

  it('names the component a cva variable belongs to', () => {
    expect(componentForVariants('buttonVariants')).toBe('Button')
    expect(componentForVariants('badgeVariants')).toBe('Badge')
  })
})
