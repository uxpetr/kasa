# Pilot dashboard (P-13)

The pilot runs **4 weeks**. Gate G1 passes if **at least 40%** of the links and photos shared during it get one or more replies (D-159, D-178). Analytics go server-side to PostHog EU Cloud (D-179). This page says how to build the dashboard there (F-14).

## Setup

1. Create a PostHog project on **EU Cloud** (eu.posthog.com) used only for production Kasa.
2. Put its Project API key (`phc_…`) in `POSTHOG_API_KEY` for the web app in production. Leave it empty locally and in CI; events are then printed as JSON lines.
3. Create a dashboard called "Kasa pilot" with the two SQL insights below (New insight → SQL). Replace `2026-10-01` with the pilot's first day.

Events carry ids and enums only (D-129). `distinct_id` is the Kasa user id. No person profiles are created.

| Event | Properties | Sent when |
| --- | --- | --- |
| `entry_created` | `projectId`, `entryId`, `kind`, `source` | Someone posts anything (Kasa Bot's welcome card is not tracked) |
| `reply_created` | `projectId`, `entryId`, `replyToId`, `kind`, `toKind`, `own` | The post is a reply; `own` is true when replying to your own entry |
| `feed_opened` | `projectId` | A member opens a project's feed in the browser |
| `reaction_added` | `projectId`, `emoji` | Someone reacts |
| `signed_up`, `signed_in`, `project_created`, `invite_sent`, `invite_accepted`, `entry_deleted`, `feedback_sent` | ids only | As named |

## Insight 1: G1, links and photos with a reply

```sql
WITH
  shared AS (
    SELECT DISTINCT properties.entryId AS id
    FROM events
    WHERE event = 'entry_created'
      AND properties.kind IN ('link', 'photo')
      AND timestamp >= toDateTime('2026-10-01') AND timestamp < toDateTime('2026-10-01') + INTERVAL 28 DAY
  ),
  replied AS (
    SELECT DISTINCT properties.replyToId AS id
    FROM events
    WHERE event = 'reply_created' AND properties.toKind IN ('link', 'photo')
  )
SELECT
  count() AS shared_items,
  countIf(id IN (SELECT id FROM replied)) AS with_a_reply,
  round(100 * with_a_reply / shared_items, 1) AS percent_with_reply,
  percent_with_reply >= 40 AS passes_g1
FROM shared
```

This counts every reply, including someone replying to their own link. To count only replies from someone else, add `AND properties.own = false` to `replied`. Deleted entries still count, because they were shared.

## Insight 2: items added per active user, per week

An active user did at least one of: opened a feed, posted, replied, or reacted that week.

```sql
SELECT
  toStartOfWeek(timestamp, 1) AS week,
  countIf(event = 'entry_created') AS items_added,
  uniqIf(distinct_id, event IN ('feed_opened', 'entry_created', 'reply_created', 'reaction_added')) AS active_users,
  round(items_added / active_users, 2) AS items_per_active_user
FROM events
WHERE timestamp >= toDateTime('2026-10-01') AND timestamp < toDateTime('2026-10-01') + INTERVAL 28 DAY
GROUP BY week
ORDER BY week
```

## Feedback

Messages from "Send feedback" (D-181) aren't in PostHog. They're listed at `/feedback` for the addresses in `PILOT_ADMIN_EMAILS`, and emailed to `FEEDBACK_EMAIL` once Resend is set up (F-13).
