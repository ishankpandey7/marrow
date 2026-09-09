import { notFound } from "next/navigation";
import { Reader } from "@/components/reader/reader";
import { READER_FIXTURES, readerFixture } from "@/components/reader/fixtures";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Reader samples",
  robots: { index: false, follow: false },
};

export default async function ReaderPreview({
  params,
}: PageProps<"/reader-preview/[id]">) {
  const { id } = await params;
  const fixture = await readerFixture(id);
  if (!fixture) notFound();
  return (
    <Reader
      {...fixture}
      storageScope="fixture-preview"
      preview
      fixtureNavigation={
        <details className="reader-fixtures">
          <summary>Reader samples · {id.replaceAll("_", " ")}</summary>
          <p>
            Fixture content. Appearance and position stay in this browser;
            nothing is written to a library. Source links use reserved example
            domains.
          </p>
          <nav aria-label="Reader fixtures">
            {READER_FIXTURES.map((name) => (
              <a
                key={name}
                href={`/reader-preview/${name}`}
                aria-current={name === id ? "page" : undefined}
              >
                {name.replaceAll("_", " ")}
              </a>
            ))}
          </nav>
        </details>
      }
    />
  );
}
