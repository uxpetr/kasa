import { objectStyle } from "../rotation";

interface PolaroidProps {
  src: string;
  alt: string;
  caption?: string;
  rotate?: number;
  /** More photos in the same stack; shown as "+N". */
  moreCount?: number;
  imageHeight?: number;
}

export function Polaroid({ src, alt, caption, rotate = -1.5, moreCount, imageHeight = 130 }: PolaroidProps) {
  return (
    <figure className="kasa-object kasa-polaroid" style={{ ...objectStyle(rotate, { "--kasa-image-height": `${imageHeight}px` }), margin: 0 }}>
      <img src={src} alt={alt} />
      {caption ? <figcaption className="kasa-polaroid-caption">{caption}</figcaption> : null}
      {moreCount ? (
        <span className="kasa-count" aria-label={`${moreCount} more photos`}>
          +{moreCount}
        </span>
      ) : null}
    </figure>
  );
}
