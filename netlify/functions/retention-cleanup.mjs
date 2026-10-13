import { adminSupabase } from "../../src/supabase-clients.js";

export default async () => {
  const { data, error } = await adminSupabase().rpc("delete_expired_reports");
  if (error) {
    console.error("PhishLens retention cleanup failed:", error);
    throw error;
  }
  console.log(`PhishLens retention cleanup removed ${data} expired report(s).`);
  return new Response("ok");
};

export const config = { schedule: "17 3 * * *" };
