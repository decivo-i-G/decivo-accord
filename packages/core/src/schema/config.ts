import { z } from 'zod'

export const OwnerSchema = z.enum(['design', 'code', 'register'])

/**
 * A justified exception: literal values that are fine where they are (domain data, third-party logos,
 * theme playgrounds). Shown in reports as "allowed" with the reason, never silently dropped.
 */
export const AllowRuleSchema = z
  .object({
    reason: z.string().min(1),
    /** File globs the rule applies to. Without `files` it applies everywhere. */
    files: z.array(z.string()).optional(),
    /** Literal values (colours compared by value, e.g. `#0ACF83`). Without `values` every value in `files` is allowed. */
    values: z.array(z.string()).optional(),
  })
  .refine((r) => r.files !== undefined || r.values !== undefined, 'an allow rule needs files, values or both')

export type AllowRule = z.infer<typeof AllowRuleSchema>

const CodeSurfaceSchema = z.object({
  enabled: z.boolean().default(true),
  /** Files scanned for hard-coded values and component usage. */
  include: z.array(z.string()).default(['src/**/*.{ts,tsx,js,jsx,css}']),
  exclude: z.array(z.string()).default(['**/*.test.*', '**/*.stories.*', '**/node_modules/**']),
  /**
   * Files that render where CSS variables do not exist (e-mail HTML, PDFs, OG images). Literal values there are
   * reported separately and do not count against the health score. Files importing next/og, satori,
   * @react-pdf/renderer or react-email are detected automatically.
   */
  inline_only: z
    .array(z.string())
    .default([
      '**/email/**',
      '**/emails/**',
      '**/*-email.*',
      '**/pdf/**',
      '**/*-pdf.*',
      '**/og/**',
      '**/og.*',
      '**/*-og.*',
      '**/opengraph-image.*',
      '**/twitter-image.*',
    ]),
  /** Justified exceptions for hard-coded values. */
  allow: z.array(AllowRuleSchema).default([]),
  /** Stylesheet(s) that define the CSS custom properties, e.g. `src/app/globals.css`. `@import`s are followed. */
  css: z.array(z.string()).default([]),
  /**
   * Selector per non-default context of the register, e.g. `{ dark: '[data-theme="dark"]' }` or
   * `{ dark: '@media (prefers-color-scheme: dark)' }`. Without an entry, `dark` is detected (`.dark` first).
   */
  modes: z.record(z.string(), z.string().min(1)).optional(),
  /** Generated files Accord writes from the register. */
  outputs: z.array(z.object({ format: z.enum(['css', 'tailwind']), path: z.string() })).default([]),
})

const ClaudeDesignSurfaceSchema = z.object({
  enabled: z.boolean().default(false),
  /** Name or id of the Claude Design design-system project. */
  project: z.string().optional(),
  /** Selector per non-default context in the project's stylesheets, as for code. Without it: `surfaces.code.modes`. */
  modes: z.record(z.string(), z.string().min(1)).optional(),
})

const FigmaSurfaceSchema = z.object({
  enabled: z.boolean().default(false),
  file_key: z.string().optional(),
  /** Variable exports in the repository (Figma's DTCG export, DTCG plugins, Tokens Studio). */
  include: z.array(z.string()).default(['figma/**/*.json', '**/*.figma.json', '**/*.fig']),
  /** Mode compared with the register; the others are kept as theme values. Default: Light/Default/first. */
  default_mode: z.string().optional(),
})

const PenSurfaceSchema = z.object({
  enabled: z.boolean().default(false),
  include: z.array(z.string()).default(['**/*.pen']),
})

export const OwnershipRuleSchema = z.object({
  /** Register path pattern, e.g. `tokens.color.**` or `components.*.props.**`. */
  match: z.string().min(1),
  owner: OwnerSchema,
  why: z.string().optional(),
})

export const ConfigSchema = z.object({
  version: z.literal(1),
  name: z.string().optional(),
  /**
   * Language the register's own text is written in (rule names, `why`, fix hints, descriptions), as a
   * BCP 47 tag such as `de` or `en`. Tools mark that text with it when their interface speaks another
   * language, so screen readers pronounce it correctly. Unset: unknown, nothing is marked.
   */
  language: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'a language tag such as de or en-GB')
    .optional(),
  surfaces: z
    .object({
      code: CodeSurfaceSchema.prefault({}),
      claude_design: ClaudeDesignSurfaceSchema.prefault({}),
      figma: FigmaSurfaceSchema.prefault({}),
      pen: PenSurfaceSchema.prefault({}),
    })
    .prefault({}),
  ownership: z
    .object({
      /** Owner of everything no rule matches. */
      default: OwnerSchema.default('register'),
      rules: z.array(OwnershipRuleSchema).default([]),
    })
    .prefault({}),
  routing: z
    .object({
      /**
       * Minimum confidence to apply a change automatically, per risk level.
       * High-risk changes (breaking, deletions, `must` violations) always go to a human; that is not configurable.
       */
      auto_apply: z
        .object({
          low: z.number().min(0).max(1).default(0.85),
          medium: z.number().min(0).max(1).default(0.95),
        })
        .prefault({}),
    })
    .prefault({}),
  matching: z
    .object({
      /** CIEDE2000 distance under which an unknown colour counts as a near miss of a token. */
      color_near_delta_e: z.number().positive().default(5),
    })
    .prefault({}),
  outputs: z
    .object({
      design_md: z.string().default('DESIGN.md'),
      agents_md: z.string().default('AGENTS.md'),
      claude_md: z.string().optional(),
    })
    .prefault({}),
})

export type Config = z.infer<typeof ConfigSchema>
export type OwnershipRule = z.infer<typeof OwnershipRuleSchema>
