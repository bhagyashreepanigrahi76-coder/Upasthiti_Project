// The first plugin is a no-op unless Tailwind's native binary is blocked by
// Windows Application Control; see tailwind-wasm-fallback.cjs.
const config = {
  plugins: [process.cwd() + "/tailwind-wasm-fallback.cjs", "@tailwindcss/postcss"],
};

export default config;
