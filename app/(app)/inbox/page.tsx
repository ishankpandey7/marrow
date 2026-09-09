import { redirect } from "next/navigation";
import { loadLibrary } from "@/app/(app)/actions";
import { OrganiseInbox } from "@/components/filter-bar";
import { parseFilters } from "@/lib/tags";

export const metadata = { title: "Library" };
export const dynamic = "force-dynamic";

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const filters = parseFilters(await searchParams);
  const result = await loadLibrary(filters);
  if (result.signedOut) redirect("/auth/sign-in?next=/inbox");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-6">
      {result.snapshot ? (
        <OrganiseInbox initial={result.snapshot} filters={filters} />
      ) : (
        <p
          role="alert"
          className="rounded-lg border border-edge p-4 text-red-400"
        >
          {result.message}
        </p>
      )}
    </main>
  );
}
