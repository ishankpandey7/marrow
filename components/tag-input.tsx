"use client";

import { useId, useState } from "react";
import { normalizeTag, type Tag } from "@/lib/tags";

export function TagInput({
  tags,
  onTag,
  label = "Add tag",
  autoFocus = false,
  disabled = false,
}: {
  tags: Tag[];
  onTag: (name: string) => void;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The complete catalogue is cached in the parent snapshot. Native datalist
  // matching needs no requests, so typing cannot generate a request per letter.
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const tag = normalizeTag(value);
          onTag(tag.name);
          setValue("");
          setError(null);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Invalid tag.");
        }
      }}
      className="space-y-2"
    >
      <label htmlFor={id} className="block text-sm text-ink-dim">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          list={`${id}-tags`}
          autoFocus={autoFocus}
          autoComplete="off"
          value={value}
          disabled={disabled}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-w-0 flex-1 rounded-lg border border-edge bg-ground-raised px-3 py-2 text-ink"
        />
        <datalist id={`${id}-tags`}>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.name} />
          ))}
        </datalist>
        <button
          disabled={disabled || !value.trim()}
          className="rounded-lg bg-accent px-3 py-2 text-ground disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
