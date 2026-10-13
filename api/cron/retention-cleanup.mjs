import { adminSupabase } from "../../src/supabase-clients.js";

export const GET = async (request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data, error } = await adminSupabase().rpc("delete_expired_reports");
  if (error) {
    console.error("PhishLens retention cleanup failed:", error);
    return Response.json({ error: "Cleanup failed" }, { status: 500 });
  }
  console.log(`PhishLens retention cleanup removed ${data} expired report(s).`);
  return Response.json({ ok: true, deleted: data });
};
