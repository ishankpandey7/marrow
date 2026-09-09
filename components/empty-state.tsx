/**
 * "No items" describes the screen. It does not tell anyone what to do about
 * it, and the first screen after signing up is the one place where that
 * matters most.
 */
export function EmptyState() {
  return (
    <div className="mt-2 border-t border-edge py-14 text-center">
      <p className="font-serif text-xl text-ink">Your library is empty.</p>
      <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-balance text-ink-dim">
        Paste a link in the box above. We will fetch the page, strip it back to
        the article, and keep a clean copy here for you to read later.
      </p>
    </div>
  );
}
