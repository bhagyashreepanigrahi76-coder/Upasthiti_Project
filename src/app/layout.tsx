import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP_NAME, COLLEGE_NAME } from "@/lib/config";
import { NavProgress } from "@/components/nav-progress";
import { ThemeToggle } from "@/components/theme-toggle";

// Runs before first paint so a saved dark choice never flashes light.
const themeScript = `try{if(localStorage.getItem("upasthiti-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: `Attendance, timetable, results and notices for ${COLLEGE_NAME}.`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#7a1f2b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        <NavProgress />
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}
