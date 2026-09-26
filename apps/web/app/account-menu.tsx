"use client";

import { avatarColor, initialOf } from "@kasa/ui";
import { authClient } from "@/lib/auth-client";
import styles from "./piles.module.css";

/** The round account button; opens a small menu with the name and Sign out. */
export function AccountMenu({ user }: { user: { id: string; name: string } }) {
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
      <div id="account-menu" popover="auto" className={styles.menu}>
        <p className={styles.menuName}>{user.name}</p>
        <button
          type="button"
          className={styles.secondary}
          onClick={async () => {
            await authClient.signOut();
            window.location.assign("/");
          }}
        >
          Sign out
        </button>
      </div>
    </>
  );
}
