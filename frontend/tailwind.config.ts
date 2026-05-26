import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "navy-950": "#06091A",
        "navy-900": "#0D1229",
        "navy-700": "#1A2142",
        "cream-100": "#F2EDE4",
        "cream-300": "#C8BFB0",
        "gold-400": "#C9933A",
        "gold-200": "#E8C87A",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        serif: ["var(--font-crimson)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
