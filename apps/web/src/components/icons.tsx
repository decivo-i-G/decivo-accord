import type { JSX, SVGProps } from 'react'

/**
 * The app's icon set: Lucide (pinned in package.json) for interface icons, plus simple monochrome
 * marks for the four surfaces. The marks only hint at each tool; they are not the tools' logos.
 */
export {
  ArrowLeft,
  ArrowRight,
  Bold,
  BookOpen,
  Bot,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Clock,
  Code,
  Component,
  Copy,
  CornerDownLeft,
  ExternalLink,
  FileText,
  FolderGit2,
  Frame,
  GitBranch,
  Hash,
  HeartPulse,
  Inbox,
  Info,
  Keyboard,
  Languages,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Menu,
  Monitor,
  Moon,
  Palette,
  PenTool,
  Plug,
  Plus,
  Ruler,
  Scale,
  Search,
  Settings,
  Sparkles,
  Spline,
  SquareStack,
  Sun,
  SunMoon,
  Timer,
  Trash2,
  TriangleAlert,
  Type,
  Undo2,
  X,
} from 'lucide-react'

export type SurfaceTool = 'figma' | 'pen' | 'claude_design' | 'code'

type MarkProps = SVGProps<SVGSVGElement> & { size?: number | string }

function Mark({ size = 20, children, ...rest }: MarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** Figma: a frame of rounded cells with one round node, drawn as an outline. */
export function FigmaMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M8.5 3h3.5v6H8.5a3 3 0 0 1 0-6Z" />
      <path d="M12 3h3.5a3 3 0 0 1 0 6H12Z" />
      <path d="M8.5 9H12v6H8.5a3 3 0 0 1 0-6Z" />
      <circle cx="15.5" cy="12" r="3" />
      <path d="M8.5 15H12v3a3 3 0 1 1-3.5-3Z" />
    </Mark>
  )
}

/** Pencil (.pen files): a pen nib. */
export function PencilMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M12 3 6 13l2 7h8l2-7Z" />
      <path d="M12 3v8" />
      <circle cx="12" cy="13" r="1.5" />
    </Mark>
  )
}

/** Claude Design: a radiating spark. */
export function ClaudeDesignMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M12 3v5.5" />
      <path d="M12 15.5V21" />
      <path d="M3 12h5.5" />
      <path d="M15.5 12H21" />
      <path d="m5.6 5.6 3.9 3.9" />
      <path d="m14.5 14.5 3.9 3.9" />
      <path d="m18.4 5.6-3.9 3.9" />
      <path d="m9.5 14.5-3.9 3.9" />
    </Mark>
  )
}

/** Code: angle brackets. */
export function CodeMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="m8 7-5 5 5 5" />
      <path d="m16 7 5 5-5 5" />
      <path d="m13.5 5-3 14" />
    </Mark>
  )
}

const MARKS: Record<SurfaceTool, (props: MarkProps) => JSX.Element> = {
  figma: FigmaMark,
  pen: PencilMark,
  claude_design: ClaudeDesignMark,
  code: CodeMark,
}

/** Monochrome mark for a surface; decorative, so always pair it with the tool's name. */
export function ToolIcon({ tool, ...props }: MarkProps & { tool: SurfaceTool }) {
  const Component = MARKS[tool]
  return <Component {...props} />
}
