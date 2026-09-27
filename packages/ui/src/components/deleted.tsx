import { objectStyle } from "../rotation";

/** What's left of a deleted object: a dashed outline, so the conversation still makes sense (D-155). */
export function DeletedOutline({ text, rotate = 1.5 }: { text: string; rotate?: number }) {
  return (
    <p className="kasa-deleted" style={objectStyle(rotate)}>
      {text}
    </p>
  );
}
