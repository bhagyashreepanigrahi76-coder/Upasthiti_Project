import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/config";

// Lets students install the web app on their phone's home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: "Upasthiti: attendance, timetable, results, library and notes for BCA & BBA.",
    start_url: "/login",
    display: "standalone",
    background_color: "#fbf7f0",
    theme_color: "#7a1f2b",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
