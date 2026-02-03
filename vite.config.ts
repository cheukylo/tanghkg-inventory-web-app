import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";


export default defineConfig({
  server: {
    host: true,
    port: 5173,

    // THIS FIXES THE BLOCKED REQUEST
    allowedHosts: [
      "localhost",
      ".trycloudflare.com", // allow all Cloudflare tunnel hosts
    ],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png"],
      manifest: {
        name: "Inventory",
        short_name: "Inventory",
        description: "QR-based inventory manager",
        theme_color: "#2B0909",
        background_color: "#FBF7F6",
        display: "standalone",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
    tailwindcss()
  ],
});