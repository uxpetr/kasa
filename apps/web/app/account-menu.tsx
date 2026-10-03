"use client";

import { useState } from "react";
import { avatarColor, initialOf } from "@kasa/ui";
import { authClient } from "@/lib/auth-client";
import controls from "./controls.module.css";
import { useFeedbackDialog } from "./feedback-dialog";
import styles from "./piles.module.css";

/** The round account button; opens a small menu with the name, Link Telegram (P-18), Send feedback (D-181), and Sign out. */
export function AccountMenu({ user, telegram }: { user: { id: string; name: string }; telegram: { available: boolean; linked: boolean } }) {
  const [openFeedback, feedbackDialog] = useFeedbackDialog();
  const [linked, setLinked] = useState(telegram.linked);
  const [telegramError, setTelegramError] = useState<string | null>(null);

  // Opens the bot in Telegram with a one-time code; pressing Start there links the account (D-207).
  // The tab opens on the click, before the request, so it isn't blocked as a popup.
  async function linkTelegram() {
    setTelegramError(null);
    const tab = window.open("", "_blank");
    const res = await fetch("/api/telegram/account", { method: "POST" }).catch(() => null);
    const url = res?.ok ? ((await res.json()) as { url: string }).url : null;
    if (!url || !tab) {
      tab?.close();
      return setTelegramError("Couldn't open Telegram. Try again.");
    }
    tab.opener = null;
    tab.location.href = url;
  }
  return (
    <>
      <button
        type="button"
        className={styles.account}
        style={{ background: avatarColor(user.id) }}
        popoverTarget="account-menu"
        aria-label="Your account"
      >
        {initialOf(user.name)}
      </button>
      <div id="account-menu" popover="auto" className={controls.menu}>
        <p className={styles.menuName}>{user.name}</p>
        <div className={styles.accountActions}>
          {telegram.available ? (
            <button
              type="button"
              className={controls.secondary}
              onClick={async () => {
                if (!linked) return void linkTelegram();
                const res = await fetch("/api/telegram/account", { method: "DELETE" }).catch(() => null);
                if (res?.ok) setLinked(false);
                else setTelegramError("Couldn't unlink. Try again.");
              }}
            >
              {linked ? "Unlink Telegram" : "Link Telegram"}
            </button>
          ) : null}
          {telegramError ? (
            <p role="alert" className={controls.error}>
              {telegramError}
            </p>
          ) : null}
          <button
            type="button"
            className={controls.secondary}
            onClick={() => {
              document.getElementById("account-menu")?.hidePopover();
              openFeedback();
            }}
          >
            Send feedback
          </button>
          <button
            type="button"
            className={controls.secondary}
            onClick={async () => {
              await authClient.signOut();
              window.location.assign("/");
            }}
          >
            Sign out
          </button>
        </div>
      </div>
      {feedbackDialog}
    </>
  );
}
