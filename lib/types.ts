/**
 * Row shapes for the tables this slice touches.
 *
 * ARCHITECTURE.md section 3 says database types are generated, not written.
 * They are written here because `supabase gen types` needs either a Supabase
 * access token or a working connection string, and this project has neither
 * configured yet. Replace this file with generated output as soon as
 * SUPABASE_DB_URL works — the note in ROADMAP.md tracks it.
 *
 * Until then: these must match docs/SCHEMA.sql by hand.
 */

export type ItemStatus = "pending" | "ready" | "failed";

export type FailReason =
  | "blocked_url"
  | "unreachable"
  | "not_found"
  | "forbidden"
  | "paywalled"
  | "too_large"
  | "unsupported_type"
  | "js_required"
  | "no_content"
  | "server_error";

export interface Item {
  id: string;
  user_id: string;
  url: string;
  canonical_url: string;
  url_hash: string;
  title: string | null;
  author: string | null;
  site_name: string | null;
  excerpt: string | null;
  lead_image_url: string | null;
  lang: string | null;
  word_count: number | null;
  reading_minutes: number | null;
  published_at: string | null;
  status: ItemStatus;
  fail_reason: FailReason | null;
  favourite: boolean;
  archived_at: string | null;
  read_progress: number;
  read_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The subset the list renders. Keeps the inbox query honest about what it needs. */
export type ItemListRow = Pick<
  Item,
  | "id"
  | "url"
  | "canonical_url"
  | "title"
  | "site_name"
  | "excerpt"
  | "reading_minutes"
  | "status"
  | "fail_reason"
  | "created_at"
>;

export const ITEM_LIST_COLUMNS =
  "id, url, canonical_url, title, site_name, excerpt, reading_minutes, status, fail_reason, created_at";
