'use client'

/** "How does this screen work?" — one small action, next to the thing it
 *  explains.
 *
 *  The guides are a library at /guides, but nobody goes looking for a library
 *  in the middle of a task. So the screens that a guide covers carry a quiet
 *  link into the RIGHT SECTION of the right guide, and that is all: a text
 *  button or a question mark, never a panel over the working interface and
 *  never a tour that starts itself.
 *
 *  The link is just a route. It carries no permission claim: a reader who may
 *  not read that guide lands on the library's "this guide is not available"
 *  answer, which is the same answer as for a guide that does not exist. */
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'

export interface GuideHelpLinkProps {
  /** The guide's address — its slug in the library. */
  slug: string
  /** The section to open at. Anchors are permanent, so this keeps working. */
  anchor?: string
  /** What the button says. Omit for the icon-only question mark. */
  label?: string
  /** The tooltip and the accessible name; say which guide it opens. */
  title: string
  className?: string
}

export function GuideHelpLink({ slug, anchor, label, title, className = '' }: GuideHelpLinkProps) {
  const router = useRouter()
  const to = anchor ? `/guides/${slug}#${anchor}` : `/guides/${slug}`
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => router.push(to)}
      title={title}
      aria-label={label ? undefined : title}
      className={className}
    >
      {label ?? (
        <span aria-hidden="true" className="inline-block h-4 w-4 text-center leading-4">?</span>
      )}
    </Button>
  )
}
