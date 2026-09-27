"use client";

import { useId, type FormEvent, type InputHTMLAttributes, type Ref } from "react";

interface ComposerProps {
  /** Accessible name, e.g. "Add to Japan 2027". */
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onAttach?: () => void;
  sendLabel?: string;
  disabled?: boolean;
  /** Allow sending with no text, e.g. when photos are attached. */
  canSubmitEmpty?: boolean;
  /** Extra attributes for the input, e.g. combobox roles for @mention autocomplete. */
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type" | "value" | "onChange" | "disabled">;
  inputRef?: Ref<HTMLInputElement>;
}

/** The input at the bottom of the zen chat. Enter sends. */
export function Composer({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  onAttach,
  sendLabel = "Send",
  disabled,
  canSubmitEmpty,
  inputProps,
  inputRef,
}: ComposerProps) {
  const inputId = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if ((text || canSubmitEmpty) && !disabled) onSubmit(text);
  };
  return (
    <form className="kasa-composer" onSubmit={submit}>
      {onAttach ? (
        <button type="button" className="kasa-composer-attach" aria-label="Attach an image or file" onClick={onAttach}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      ) : null}
      <label htmlFor={inputId} className="kasa-visually-hidden">
        {label}
      </label>
      <input
        {...inputProps}
        ref={inputRef}
        id={inputId}
        className="kasa-composer-input"
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoComplete="off"
      />
      <button type="submit" className="kasa-composer-send" disabled={disabled || (!value.trim() && !canSubmitEmpty)}>
        {sendLabel}
      </button>
    </form>
  );
}
