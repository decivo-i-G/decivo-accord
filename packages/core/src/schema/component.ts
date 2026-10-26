import { z } from 'zod'
import { OwnerSchema } from './config.js'

const DeprecatedSchema = z.union([z.boolean(), z.string()])

export const PropSchema = z.object({
  /** Framework-neutral type: boolean, string, number, enum, node, function, or a free-form TS-like type. */
  type: z.string().min(1),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  /** Allowed values for `type: enum`. */
  values: z.array(z.string()).optional(),
  description: z.string().optional(),
  deprecated: DeprecatedSchema.optional(),
})

export const ComponentSchema = z.object({
  name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'component names are PascalCase, e.g. Button'),
  status: z.enum(['draft', 'stable', 'deprecated']).default('stable'),
  description: z.string().optional(),
  deprecated: DeprecatedSchema.optional(),
  /** Named parts, e.g. [root, icon, label]. */
  anatomy: z.array(z.string()).default([]),
  /** Visual variant axes and their options, e.g. { variant: [primary, ghost], size: [sm, md] }. */
  variants: z.record(z.string(), z.array(z.string()).min(1)).default({}),
  props: z.record(z.string(), PropSchema).default({}),
  states: z.array(z.string()).default([]),
  slots: z.record(z.string(), z.enum(['required', 'optional'])).default({}),
  /** Token paths (without `tokens.`) the component is built from. */
  tokens: z.array(z.string()).default([]),
  a11y: z
    .object({
      role: z.string().optional(),
      min_target: z.number().positive().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  /** Per-field ownership exceptions, e.g. { "props.asChild": register }. */
  owners: z.record(z.string(), OwnerSchema).default({}),
  mappings: z
    .object({
      code: z
        .object({
          path: z.string(),
          export: z.string(),
          story: z.union([z.string(), z.array(z.string())]).optional(),
        })
        .optional(),
      claude_design: z.object({ path: z.string() }).optional(),
      figma: z
        .object({
          file_key: z.string(),
          node_id: z.string().optional(),
          component_key: z.string().optional(),
        })
        .optional(),
      pen: z.object({ path: z.string(), node_id: z.string().optional() }).optional(),
    })
    .prefault({}),
})

export type ComponentContract = z.infer<typeof ComponentSchema>
export type PropContract = z.infer<typeof PropSchema>
