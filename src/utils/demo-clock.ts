export function getDemoDate(): Date {
  if (process.env.DEMO_MODE === "true") {
    return new Date("2026-09-10T12:00:00-07:00");
  }
  return new Date();
}
