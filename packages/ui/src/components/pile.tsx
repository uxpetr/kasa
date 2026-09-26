import type { ElementType, ReactNode } from "react";
import { clampRotation, tiltFor } from "../rotation";
import { AvatarStack, type Person } from "./avatar";

export interface PileProps {
  id: string;
  href: string;
  title: string;
  /** The last entry, already worded (D-145). */
  preview?: ReactNode;
  unread?: number;
  members: Person[];
  /** Bottom-right: when the last thing happened. Hidden when a photo peeks out. */
  meta?: ReactNode;
  /** The latest image, peeking out as a polaroid. */
  peek?: { src: string; alt: string };
  /** One member: drawn as a yellow sticky instead of a stack (D-144). */
  personal?: boolean;
  archived?: boolean;
  /** Link component, e.g. next/link; a plain <a> by default. */
  link?: ElementType;
}

/**
 * A project on the projects screen, drawn as a stack of paper (design/prototype/Projects.dc.html).
 * Tilts come from the id so a pile never shifts between renders.
 */
export function Pile({ id, href, title, preview, unread = 0, members, meta, peek, personal, archived, link: Link = "a" }: PileProps) {
  const t = tiltFor(id);
  const rotate = (deg: number) => ({ transform: `rotate(${clampRotation(deg)}deg)` });
  const memberLabel = `${members.length} ${members.length === 1 ? "member" : "members"}: ${members.map((m) => m.name).join(", ")}`;

  return (
    <div className="kasa-pile" data-personal={personal || undefined} data-archived={archived || undefined}>
      {personal ? null : (
        <>
          <div className="kasa-pile-sheet" style={rotate(t >= 0 ? -1.2 - t / 2 : 1.4 - t / 2)} aria-hidden="true" />
          <div className="kasa-pile-sheet" style={rotate(t >= 0 ? 1.4 : -1.2)} aria-hidden="true" />
        </>
      )}
      <Link href={href} className="kasa-pile-top" style={rotate(t / 3)}>
        <span className="kasa-pile-head">
          <span className="kasa-pile-title">{title}</span>
          {unread > 0 ? <span className="kasa-pile-unread">{unread} new</span> : null}
        </span>
        {preview ? <span className="kasa-pile-preview">{preview}</span> : null}
        <span className="kasa-pile-foot">
          {personal ? <span /> : <AvatarStack people={members} label={memberLabel} />}
          {peek ? null : meta ? <span className="kasa-pile-meta">{meta}</span> : null}
        </span>
        {peek ? (
          <span className="kasa-pile-peek" style={rotate(2.5)}>
            <img src={peek.src} alt={peek.alt} />
          </span>
        ) : null}
      </Link>
    </div>
  );
}
