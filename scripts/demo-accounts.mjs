// The demo accounts the scripts sign in with. Start the test server with
//   SEED_PASSWORD=Demo#Campus2026 SEED_MUST_CHANGE=false
// so every seeded account has this one known password and no forced change (never do this on a real database).
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "Demo#Campus2026";

const IDS = {
  student: "2024-00417",
  staff: "EMP-2031",
  agent: "AGT-1001",
  agent2: "AGT-1002",
  agent3: "AGT-1003",
  admin: "ADM-0001",
  superadmin: "SUP-0001",
  report_viewer: "RPT-0001",
};
export const idFor = (role) => IDS[role] ?? IDS.student;
