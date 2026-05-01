import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        comic: ["var(--font-comic-neue)", "cursive"]
      },
      boxShadow: {
        chunky: "4px 4px 0 #000000",
        chunkyLg: "6px 6px 0 #000000"
      }
    }
  },
  plugins: []
};

export default config;
