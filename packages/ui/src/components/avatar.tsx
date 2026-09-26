import { tokens } from "../tokens";

export interface Person {
  id: string;
  name: string;
}

/** First letter of the first name, upper-cased; "?" when there's nothing usable. */
export function initialOf(name: string): string {
  const letter = name.trim().match(/\p{L}|\p{N}/u)?.[0];
  return letter ? letter.toLocaleUpperCase() : "?";
}

/** A stable colour per person from the avatar palette, so someone looks the same everywhere. */
export function avatarColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return tokens.avatar[Math.abs(h) % tokens.avatar.length]!;
}

export function Avatar({ person, size = 30 }: { person: Person; size?: number }) {
  return (
    <span className="kasa-avatar" style={{ background: avatarColor(person.id), width: size, height: size }} title={person.name}>
      {initialOf(person.name)}
    </span>
  );
}

/** Overlapping member avatars; past `max`, the rest show as "+N". */
export function AvatarStack({ people, max = 5, label }: { people: Person[]; max?: number; label: string }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="kasa-avatar-stack" role="img" aria-label={label}>
      {shown.map((p) => (
        <Avatar key={p.id} person={p} />
      ))}
      {rest > 0 ? <span className="kasa-avatar kasa-avatar-more">+{rest}</span> : null}
    </span>
  );
}
