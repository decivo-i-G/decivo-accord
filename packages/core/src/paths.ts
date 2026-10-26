/**
 * Register paths are dot-separated and prefixed by their kind:
 *   tokens.color.brand.700
 *   components.Button.props.disabled
 *   decisions.D-004
 *
 * Patterns use `*` for exactly one segment and `**` for any number of segments (including none).
 * A segment may also contain `*` as a wildcard inside it, e.g. `brand-*`.
 */

export const splitPath = (path: string): string[] => (path === '' ? [] : path.split('.'))
export const joinPath = (segments: readonly string[]): string => segments.join('.')

const segmentMatcherCache = new Map<string, RegExp>()

function segmentMatches(pattern: string, segment: string): boolean {
  if (pattern === '*') return true
  if (!pattern.includes('*')) return pattern === segment
  let re = segmentMatcherCache.get(pattern)
  if (!re) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    re = new RegExp(`^${escaped}$`)
    segmentMatcherCache.set(pattern, re)
  }
  return re.test(segment)
}

function matchFrom(pattern: readonly string[], pi: number, path: readonly string[], si: number): boolean {
  if (pi === pattern.length) return si === path.length
  const p = pattern[pi] as string
  if (p === '**') {
    for (let k = si; k <= path.length; k++) {
      if (matchFrom(pattern, pi + 1, path, k)) return true
    }
    return false
  }
  if (si === path.length) return false
  return segmentMatches(p, path[si] as string) && matchFrom(pattern, pi + 1, path, si + 1)
}

export function matchPath(pattern: string, path: string): boolean {
  return matchFrom(splitPath(pattern), 0, splitPath(path), 0)
}

/**
 * Compare how specific two patterns are, for picking the winning rule when several match.
 * More literal segments win, then fewer wildcards (`**` counts double). Positive means `a` is more specific.
 */
export function compareSpecificity(a: string, b: string): number {
  const score = (pattern: string) => {
    let literal = 0
    let wildcards = 0
    for (const seg of splitPath(pattern)) {
      if (seg === '**') wildcards += 2
      else if (seg.includes('*')) wildcards += 1
      else literal += 1
    }
    return { literal, wildcards }
  }
  const sa = score(a)
  const sb = score(b)
  return sa.literal - sb.literal || sb.wildcards - sa.wildcards
}
