import { createClient } from "@supabase/supabase-js";

function required(name) {
  const value = process.env[name];
  if (!value) throw Object.assign(new Error(`Chưa cấu hình ${name} trên Netlify.`), { status: 503 });
  return value;
}

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export function publicSupabase() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_ANON_KEY"), options);
}

export function adminSupabase() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), options);
}

export function allowedAdminEmails() {
  return new Set((process.env.ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}
