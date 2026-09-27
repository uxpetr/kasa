import { objectStyle } from "../rotation";

interface PolaroidProps {
  src: string;
  alt: string;
  caption?: string;
  rotate?: number;
  /** More photos in the same stack; shown as "+N" on a fanned stack. */
  moreCount?: number;
  imageHeight?: number;
  /** Makes the photo a button that opens it full size. */
  onOpen?: () => void;
  openLabel?: string;
}

export function Polaroid({ src, alt, caption, rotate = -1.5, moreCount, imageHeight = 130, onOpen, openLabel = "Open photo" }: PolaroidProps) {
  const polaroid = (
    <figure className="kasa-object kasa-polaroid" style={{ ...objectStyle(rotate, { "--kasa-image-height": `${imageHeight}px` }), margin: 0 }}>
      <img src={src} alt={alt} />
      {caption ? <figcaption className="kasa-polaroid-caption">{caption}</figcaption> : null}
      {moreCount ? (
        <span className="kasa-count" aria-label={`${moreCount} more photos`}>
          +{moreCount}
        </span>
      ) : null}
      {onOpen ? <button type="button" className="kasa-polaroid-open" aria-label={openLabel} onClick={onOpen} /> : null}
    </figure>
  );
  if (!moreCount) return polaroid;
  // Several photos sent together: the first on top, the rest fanned out behind it.
  return (
    <div className="kasa-photo-stack" style={objectStyle(rotate)}>
      <span className="kasa-stack-sheet" aria-hidden="true" />
      {moreCount > 1 ? <span className="kasa-stack-sheet" aria-hidden="true" /> : null}
      {polaroid}
    </div>
  );
}
