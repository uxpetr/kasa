"use client";

// Kasa Bot categories in the feed (P-19, D-201): the chips above it, the Categories dialog
// behind "Edit", and an entry's Categories… checklist. Categories filter; they never reorder.
import { createContext, useContext, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CategoryChip } from "@kasa/ui";
import type { CategoryChipData } from "@/lib/categories";
import type { FeedEntry } from "@/lib/entries";
import controls from "../../controls.module.css";
import styles from "./feed.module.css";

interface CategoriesApi {
  chips: CategoryChipData[];
  /** Owners and editors, not while archived. */
  canEdit: boolean;
  /** Opens the Categories dialog. */
  openEditor: () => void;
  /** Opens the Categories… checklist for one post. */
  editEntry: (entry: FeedEntry) => void;
}

export const CategoriesContext = createContext<CategoriesApi>({ chips: [], canEdit: false, openEditor: () => {}, editEntry: () => {} });
export const useCategories = () => useContext(CategoriesContext);

/** Posts have categories; replies and Kasa Bot's cards don't (D-201). */
export const hasCategories = (entry: FeedEntry) => !entry.deleted && entry.kind !== "bot" && entry.replyTo === null;

async function send(url: string, method: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (res?.ok) return { ok: true, data: (await res.json()) as unknown };
  const error = res ? (((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong") : "Something went wrong";
  return { ok: false, error };
}

/** The chips above the feed: All, then each category with its count, and "Sorted by Kasa Bot · Edit". */
export function CategoryBar({
  chips,
  postCount,
  filter,
  onFilter,
}: {
  chips: CategoryChipData[];
  postCount: number;
  filter: string | null;
  onFilter: (id: string | null) => void;
}) {
  const { canEdit, openEditor } = useCategories();
  if (chips.length === 0) return null;
  return (
    <div className={styles.categoryBar}>
      <div role="group" aria-label="Categories" className={styles.chips}>
        <CategoryChip label="All" count={postCount} pressed={filter === null} onToggle={() => onFilter(null)} />
        {chips.map((c) => (
          <CategoryChip key={c.id} label={c.name} count={c.count} pressed={filter === c.id} onToggle={() => onFilter(filter === c.id ? null : c.id)} />
        ))}
      </div>
      <div className={styles.sortedBy}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        Sorted by Kasa Bot
        {canEdit ? (
          <button type="button" className={styles.sortedByEdit} onClick={openEditor}>
            Edit
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** "New category": a name field and Add. */
function NewCategory({ projectId, onAdded }: { projectId: string; onAdded: (category: { id: string; name: string }) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = useId();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    const result = await send(`/api/projects/${projectId}/categories`, "POST", { name });
    setPending(false);
    if (!result.ok) return setError(result.error);
    setName("");
    setError(null);
    onAdded(result.data as { id: string; name: string });
  }
  return (
    <form className={styles.newCategory} onSubmit={submit}>
      <label htmlFor={id} className="kasa-visually-hidden">
        New category
      </label>
      <input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" maxLength={30} autoComplete="off" />
      <button type="submit" className={controls.secondary} disabled={pending || !name.trim()}>
        Add
      </button>
      {error ? (
        <p role="alert" className={controls.error}>
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Behind "Edit": each category with Rename, Merge into…, and Remove, plus New category (D-201). */
export function CategoriesDialog({ projectId, chips, onClose, onChanged }: { projectId: string; chips: CategoryChipData[]; onClose: () => void; onChanged: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<{ id: string; kind: "rename" | "merge" | "remove" } | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function act(url: string, method: string, body?: unknown) {
    const result = await send(url, method, body);
    if (!result.ok) return setError(result.error);
    setError(null);
    setMode(null);
    onChanged();
  }

  return (
    <dialog ref={dialog} className={`${controls.dialog} ${styles.categoriesDialog}`} aria-labelledby="categories-title" onClose={onClose}>
      <h2 id="categories-title">Categories</h2>
      <ul className={styles.categoryRows}>
        {chips.map((c) => (
          <li key={c.id} className={styles.categoryRow}>
            {mode?.id === c.id && mode.kind === "rename" ? (
              <form
                className={styles.categoryEdit}
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(`/api/categories/${c.id}`, "PATCH", { name: new FormData(e.currentTarget).get("name") });
                }}
              >
                <input name="name" defaultValue={c.name} maxLength={30} required autoFocus aria-label={`New name for ${c.name}`} autoComplete="off" />
                <button type="submit" className={controls.primary}>
                  Save
                </button>
                <button type="button" className={controls.secondary} onClick={() => setMode(null)}>
                  Cancel
                </button>
              </form>
            ) : mode?.id === c.id && mode.kind === "merge" ? (
              <form
                className={styles.categoryEdit}
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(`/api/categories/${c.id}`, "PATCH", { mergeInto: new FormData(e.currentTarget).get("into") });
                }}
              >
                <label>
                  Merge {c.name} into{" "}
                  <select name="into" autoFocus>
                    {chips
                      .filter((o) => o.id !== c.id)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button type="submit" className={controls.primary}>
                  Merge
                </button>
                <button type="button" className={controls.secondary} onClick={() => setMode(null)}>
                  Cancel
                </button>
              </form>
            ) : mode?.id === c.id && mode.kind === "remove" ? (
              <div className={styles.categoryEdit}>
                <span>Remove {c.name}? Its posts stay in the pile.</span>
                <button type="button" className={controls.primary} onClick={() => void act(`/api/categories/${c.id}`, "DELETE")}>
                  Remove
                </button>
                <button type="button" className={controls.secondary} onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <span className={styles.categoryName}>
                  {c.name} <span className={styles.categoryCount}>{c.count}</span>
                </span>
                <span className={styles.categoryActions}>
                  <button type="button" onClick={() => setMode({ id: c.id, kind: "rename" })} aria-label={`Rename ${c.name}`}>
                    Rename
                  </button>
                  {chips.length > 1 ? (
                    <button type="button" onClick={() => setMode({ id: c.id, kind: "merge" })} aria-label={`Merge ${c.name} into…`}>
                      Merge into…
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setMode({ id: c.id, kind: "remove" })} aria-label={`Remove ${c.name}`}>
                    Remove
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <NewCategory projectId={projectId} onAdded={onChanged} />
      {error ? (
        <p role="alert" className={controls.error}>
          {error}
        </p>
      ) : null}
      <div className={controls.actions}>
        <button type="button" className={controls.primary} onClick={() => dialog.current?.close()}>
          Done
        </button>
      </div>
    </dialog>
  );
}

/** An entry's Categories… checklist: each tick applies at once; New category adds and ticks one. */
export function EntryCategoriesDialog({
  projectId,
  entry,
  chips,
  onClose,
  onChange,
  onChipsChanged,
}: {
  projectId: string;
  entry: FeedEntry;
  chips: CategoryChipData[];
  onClose: () => void;
  onChange: (entry: FeedEntry) => void;
  onChipsChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(() => entry.categories.map((c) => c.id));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function save(ids: string[]) {
    setSelected(ids);
    const result = await send(`/api/entries/${entry.id}/categories`, "PUT", { categoryIds: ids });
    if (!result.ok) {
      setError(result.error);
      setSelected(entry.categories.map((c) => c.id));
      return;
    }
    setError(null);
    onChange({ ...entry, categories: (result.data as { categories: FeedEntry["categories"] }).categories });
    onChipsChanged();
  }

  return (
    <dialog ref={dialog} className={controls.dialog} aria-labelledby={`categories-${entry.id}`} onClose={onClose}>
      <h2 id={`categories-${entry.id}`}>Categories</h2>
      <fieldset className={styles.checklist}>
        <legend className="kasa-visually-hidden">Categories for this post</legend>
        {chips.map((c) => (
          <label key={c.id} className={styles.checkItem}>
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              onChange={(e) => void save(e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id))}
            />
            {c.name}
          </label>
        ))}
      </fieldset>
      <NewCategory
        projectId={projectId}
        onAdded={(category) => {
          void save([...selected, category.id]);
        }}
      />
      {error ? (
        <p role="alert" className={controls.error}>
          {error}
        </p>
      ) : null}
      <div className={controls.actions}>
        <button type="button" className={controls.primary} onClick={() => dialog.current?.close()}>
          Done
        </button>
      </div>
    </dialog>
  );
}
