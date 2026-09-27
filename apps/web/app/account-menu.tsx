"use client";

import { avatarColor, initialOf } from "@kasa/ui";
import { authClient } from "@/lib/auth-client";
import controls from "./controls.module.css";
import { useFeedbackDialog } from "./feedback-dialog";
import styles from "./piles.module.css";

/** The round account button; opens a small menu with the name, Send feedback (D-181), and Sign out. */
export function AccountMenu({ user }: { user: { id: string; name: string } }) {
  const [openFeedback, feedbackDialog] = useFeedbackDialog();
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
