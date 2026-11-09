import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/config";

// Lets students install the web app on their phone's home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: "Attendance",
    description: "Punch in/out, attendance, timetable and results.",
    start_url: "/login",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#2f5bd8",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
