import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP_NAME, COLLEGE_NAME } from "@/lib/config";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: `Attendance, timetable, results and notices for ${COLLEGE_NAME}.`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2f5bd8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
