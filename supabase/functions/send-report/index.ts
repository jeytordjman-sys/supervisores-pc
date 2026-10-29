// Edge Function «send-report»: envia por e-mail (Resend) cada linha nova da tabela outbox.
// Chamada pelo Database Webhook (INSERT em public.outbox) — ver supabase/README-instalacao.md.
// Segredos (Dashboard → Edge Functions → Secrets): RESEND_API_KEY, MAIL_FROM, WEBHOOK_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "Supervisores P&C <onboarding@resend.dev>";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

type Outbox = { id: number; to_email: string; cc_email: string; subject: string; body: string; status: string };

async function send(rec: Outbox) {
  if (!rec.to_email) {
    await admin.from("outbox").update({ status: "skipped", error: "sem e-mail de destino" }).eq("id", rec.id);
    return { ok: false, why: "no recipient" };
  }
  const payload: Record<string, unknown> = {
    from: MAIL_FROM,
    to: [rec.to_email],
    subject: rec.subject,
    text: rec.body.replace(/\*/g, ""), // os * são negrito do WhatsApp
  };
  if (rec.cc_email && rec.cc_email !== rec.to_email) payload.cc = [rec.cc_email];
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const txt = await r.text();
  if (r.ok) {
    await admin.from("outbox").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", rec.id);
    return { ok: true };
  }
  await admin.from("outbox").update({ status: "error", error: `${r.status} ${txt.slice(0, 500)}` }).eq("id", rec.id);
  return { ok: false, why: txt };
}

Deno.serve(async (req) => {
  if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  let body: { type?: string; table?: string; record?: Outbox; resend_pending?: boolean } = {};
  try { body = await req.json(); } catch { /* chamada sem corpo: reenvia as pendentes */ }

  // Modo webhook: uma linha acabada de inserir.
  if (body.type === "INSERT" && body.table === "outbox" && body.record) {
    const res = await send(body.record);
    return Response.json(res);
  }
  // Modo manual / cron de segurança: reenvia tudo o que ficou pendente (ex.: webhook falhou).
  const { data } = await admin.from("outbox").select("*").eq("status", "pending").order("at").limit(50);
  const out = [];
  for (const rec of data ?? []) out.push({ id: rec.id, ...(await send(rec as Outbox)) });
  return Response.json({ processed: out.length, out });
});
