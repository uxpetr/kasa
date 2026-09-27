import type { ReactNode } from "react";
import { objectStyle } from "../rotation";

interface IndexCardProps {
  href: string;
  /** Small line above the title, such as "Link · example.com". */
  label: string;
  title: ReactNode;
  /** A preview image, when the link has one. */
  imageSrc?: string;
  rotate?: number;
  children?: ReactNode;
}

/** A generic link or article: a white index card with the headline; the whole card opens the page. */
export function IndexCard({ href, label, title, imageSrc, rotate = -1, children }: IndexCardProps) {
  return (
    <a className="kasa-object kasa-index-card" style={objectStyle(rotate)} href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
      {imageSrc ? <img src={imageSrc} alt="" /> : null}
      <span className="kasa-index-card-label">{label}</span>
      <span className="kasa-index-card-title">{title}</span>
      {children}
    </a>
  );
}
