import type { ButtonHTMLAttributes, ReactNode } from "react";
import { objectStyle } from "../rotation";

/**
 * Kasa Bot always uses the pine index card with the k mark, never a sticky or an avatar.
 * In the feed the k mark and name already sit beside the card, so `header={false}` drops them.
 */
export function BotCard({
  children,
  actions,
  rotate = -1,
  header = true,
}: {
  children: ReactNode;
  actions?: ReactNode;
  rotate?: number;
  header?: boolean;
}) {
  return (
    <article className="kasa-object kasa-bot" style={objectStyle(rotate)} aria-label="Kasa Bot">
      {header ? (
        <div className="kasa-bot-header">
          <span className="kasa-bot-mark" aria-hidden="true">
            k
          </span>
          <span>Kasa Bot</span>
        </div>
      ) : null}
      <div>{children}</div>
      {actions ? <div className="kasa-bot-actions">{actions}</div> : null}
    </article>
  );
}

export function BotButton({
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return <button type="button" className="kasa-bot-button" data-variant={variant} {...props} />;
}
