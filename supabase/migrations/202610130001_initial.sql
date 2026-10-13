create extension if not exists pgcrypto;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  url text not null check (char_length(url) <= 2048),
  hostname text not null check (char_length(hostname) between 1 and 253),
  type text not null check (type in (
    'Giả mạo ngân hàng/tổ chức', 'Lừa lấy mật khẩu hoặc OTP',
    'Giả mạo cơ quan/dịch vụ công', 'Tuyển dụng/việc làm giả',
    'Quà tặng/khuyến mãi', 'Đầu tư/vay đáng ngờ',
    'Liên kết rút gọn/website/tệp lạ', 'Khác'
  )),
  description text not null default '' check (char_length(description) <= 1000),
  public_summary text not null default '' check (char_length(public_summary) <= 500),
  source_url text not null default '' check (char_length(source_url) <= 2048),
  source text not null default 'website' check (char_length(source) <= 30),
  status text not null default 'Mới' check (status in ('Mới', 'Đang xem xét', 'Đã xác minh', 'Không đủ căn cứ')),
  review_note text not null default '' check (char_length(review_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null
);
alter table public.reports add column if not exists public_summary text not null default '' check (char_length(public_summary) <= 500);
alter table public.reports add column if not exists source_url text not null default '' check (char_length(source_url) <= 2048);
create index if not exists reports_created_at_idx on public.reports (created_at desc);
create index if not exists reports_hostname_status_idx on public.reports (hostname, status);
create index if not exists reports_status_type_idx on public.reports (status, type);

create table if not exists public.verified_alerts (
  id uuid primary key default gen_random_uuid(),
  hostname text not null unique check (char_length(hostname) between 1 and 253),
  url text not null check (char_length(url) <= 2048),
  type text not null,
  summary text not null default '',
  source_url text not null default '' check (char_length(source_url) <= 2048),
  status text not null default 'Đã xác minh' check (status = 'Đã xác minh'),
  source text not null,
  source_report_id uuid unique references public.reports(id) on delete set null,
  is_demo boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.verified_alerts add column if not exists source_url text not null default '' check (char_length(source_url) <= 2048);
create index if not exists verified_alerts_hostname_idx on public.verified_alerts (hostname);

alter table public.reports enable row level security;
alter table public.verified_alerts enable row level security;
revoke all on public.reports from anon, authenticated;
revoke all on public.verified_alerts from anon, authenticated;
grant all on public.reports to service_role;
grant all on public.verified_alerts to service_role;

drop function if exists public.admin_update_report(uuid, text, text, uuid);
create function public.admin_update_report(p_id uuid, p_status text, p_review_note text, p_public_summary text, p_source_url text, p_reviewed_by uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare changed public.reports;
begin
  if p_status not in ('Mới', 'Đang xem xét', 'Đã xác minh', 'Không đủ căn cứ') then raise exception 'invalid_status'; end if;
  if p_status = 'Đã xác minh' and (char_length(trim(coalesce(p_public_summary, ''))) < 20 or char_length(p_public_summary) > 500 or p_source_url !~ '^https://[^[:space:]]+$' or char_length(p_source_url) > 2048) then
    raise exception 'verified_alert_requires_summary_and_https_source';
  end if;
  update public.reports
  set status = p_status, review_note = left(coalesce(p_review_note, ''), 500),
      public_summary = left(coalesce(p_public_summary, ''), 500), source_url = left(coalesce(p_source_url, ''), 2048),
      reviewed_by = p_reviewed_by, updated_at = now()
  where id = p_id returning * into changed;
  if not found then return null; end if;

  if p_status = 'Đã xác minh' then
    insert into public.verified_alerts(hostname, url, type, summary, source_url, status, source, source_report_id, is_demo, updated_at)
    values (changed.hostname, 'https://' || changed.hostname || '/', changed.type,
      changed.public_summary, changed.source_url, 'Đã xác minh', 'Quản trị viên PhishLens', changed.id, false, now())
    on conflict (hostname) do update set url = excluded.url, type = excluded.type, summary = excluded.summary,
      source_url = excluded.source_url, source = excluded.source, source_report_id = excluded.source_report_id, is_demo = false, updated_at = now();
  else
    delete from public.verified_alerts where source_report_id = changed.id and is_demo = false;
  end if;
  return to_jsonb(changed);
end;
$$;
revoke all on function public.admin_update_report(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_update_report(uuid, text, text, text, text, uuid) to service_role;

create or replace function public.admin_report_stats()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.reports),
    'byStatus', coalesce((select jsonb_object_agg(status, amount) from (select status, count(*) amount from public.reports group by status) s), '{}'::jsonb),
    'byType', coalesce((select jsonb_object_agg(type, amount) from (select type, count(*) amount from public.reports group by type) t), '{}'::jsonb)
  );
$$;
revoke all on function public.admin_report_stats() from public, anon, authenticated;
grant execute on function public.admin_report_stats() to service_role;

create or replace function public.delete_expired_reports()
returns bigint language plpgsql security definer set search_path = public
as $$
declare deleted_count bigint;
begin
  delete from public.reports where created_at < now() - interval '12 months';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke all on function public.delete_expired_reports() from public, anon, authenticated;
grant execute on function public.delete_expired_reports() to service_role;

insert into public.verified_alerts(hostname, url, type, summary, status, source, is_demo)
values ('login-verify-example.test', 'https://login-verify-example.test/', 'Lừa lấy mật khẩu hoặc OTP',
  'Tên miền thử nghiệm do nhóm tạo để minh họa trang yêu cầu xác minh tài khoản.', 'Đã xác minh',
  'Dữ liệu Demo do nhóm PhishLens tạo', true)
on conflict (hostname) do nothing;
