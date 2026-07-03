/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#EA2831",
        "primary-hover": "#c91e26",
        secondary: "#FBEAEA",
        "background-light": "#f8f6f6",
        "background-dark": "#211111",
        "text-main": "#1C1C1C",
        "text-muted": "#6b7280"
      },
      fontFamily: {
        display: "Manrope",
        heading: ["Sora", "sans-serif"]
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px"
      },
      boxShadow: {
        soft: "0 4px 20px -2px rgba(0, 0, 0, 0.05)"
      }
    }
  },
  plugins: [],
}
