import { cva } from 'class-variance-authority'
const buttonVariants = cva('inline-flex', {
  variants: { variant: { default: 'bg-primary', ghost: 'hover:bg-muted' }, size: { default: 'h-8', sm: 'h-7' } },
})
export function Button() { return <button className="bg-primary text-primary" /> }
export { buttonVariants }
