import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "InstantAboard",
    short_name: "Aboard",
    description: "Personal Hong Kong departure board",
    start_url: "/",
    display: "standalone",
    background_color: "#efe8dc",
    theme_color: "#efe8dc",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
