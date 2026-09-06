import type { Metadata, Viewport } from "next";

import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "@/lib/constants";

import "./globals.css";

// No next/font/google. Downloading a font at build time makes every build —
// including CI — depend on fonts.googleapis.com being reachable, in exchange
// for a wordmark on one page. Slice 3 chooses the reading typeface, which is
// the place where the choice actually matters.

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — ${APP_TAGLINE}`,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
};

export const viewport: Viewport = {
  themeColor: "#0c0b0a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
