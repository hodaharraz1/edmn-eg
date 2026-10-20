// Loads .env.local / .env for CLI scripts (Next.js loads them automatically for the app).
for (const f of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* optional */
  }
}
export {};
