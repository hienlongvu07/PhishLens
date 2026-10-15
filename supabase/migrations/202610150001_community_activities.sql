create extension if not exists pgcrypto;

create table if not exists public.community_challenge_questions (
  id text primary key check (id ~ '^[a-z0-9-]{3,60}$'),
  category text not null check (char_length(category) between 2 and 100),
  prompt text not null check (char_length(prompt) between 10 and 700),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 3 and 5),
  correct_option_id text not null,
  explanation text not null check (char_length(explanation) between 10 and 700),
  safety_tip text not null check (char_length(safety_tip) between 5 and 500),
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.community_challenge_attempts (
  id uuid primary key default gen_random_uuid(),
  question_snapshot jsonb not null check (jsonb_typeof(question_snapshot) = 'array' and jsonb_array_length(question_snapshot) = 10),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  score smallint check (score between 0 and 10),
  total_questions smallint not null default 10 check (total_questions = 10)
);
create index if not exists community_challenge_attempts_started_idx on public.community_challenge_attempts (started_at desc);

create table if not exists public.community_challenge_question_results (
  attempt_id uuid not null references public.community_challenge_attempts(id) on delete cascade,
  question_id text not null,
  is_correct boolean not null,
  primary key (attempt_id, question_id)
);
create index if not exists community_challenge_question_results_question_idx on public.community_challenge_question_results (question_id, is_correct);

create table if not exists public.community_beta_feedback (
  id uuid primary key default gen_random_uuid(),
  product text not null check (product in ('website','extension','both')),
  completed_steps smallint not null check (completed_steps between 0 and 7),
  rating_ease smallint not null check (rating_ease between 1 and 5),
  rating_clarity smallint not null check (rating_clarity between 1 and 5),
  rating_speed smallint not null check (rating_speed between 1 and 5),
  rating_usefulness smallint not null check (rating_usefulness between 1 and 5),
  rating_overall smallint not null check (rating_overall between 1 and 5),
  issue text not null default '' check (char_length(issue) <= 1200),
  useful_feature text not null default '' check (char_length(useful_feature) <= 600),
  desired_feature text not null default '' check (char_length(desired_feature) <= 600),
  suggestion text not null default '' check (char_length(suggestion) <= 1000),
  status text not null default 'Mới' check (status in ('Mới','Đang xem xét','Đã xử lý')),
  category text not null default 'Chưa phân loại' check (category in ('Chưa phân loại','Lỗi','Giao diện','Nội dung','Tốc độ','Tính năng','Khác')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists community_beta_feedback_created_idx on public.community_beta_feedback (created_at desc);
create index if not exists community_beta_feedback_status_idx on public.community_beta_feedback (status, product);

create table if not exists public.community_campaign_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('campaign_view','challenge_click','beta_click','product_click','share_click','share_success')),
  utm_source text not null default '' check (char_length(utm_source) <= 80),
  created_at timestamptz not null default now()
);
create index if not exists community_campaign_events_created_idx on public.community_campaign_events (created_at desc, event_type);

create table if not exists public.community_external_metrics (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('Facebook','TikTok','Khác')),
  metric_type text not null check (metric_type in ('Lượt xem','Lượt tương tác','Lượt chia sẻ','Khác')),
  metric_value integer not null check (metric_value between 0 and 100000000),
  evidence_url text not null check (evidence_url ~ '^https://[^[:space:]]+$' and char_length(evidence_url) <= 2048),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists community_external_metrics_created_idx on public.community_external_metrics (created_at desc);

alter table public.community_challenge_questions enable row level security;
alter table public.community_challenge_attempts enable row level security;
alter table public.community_challenge_question_results enable row level security;
alter table public.community_beta_feedback enable row level security;
alter table public.community_campaign_events enable row level security;
alter table public.community_external_metrics enable row level security;
revoke all on public.community_challenge_questions, public.community_challenge_attempts, public.community_challenge_question_results,
  public.community_beta_feedback, public.community_campaign_events, public.community_external_metrics from anon, authenticated;
grant all on public.community_challenge_questions, public.community_challenge_attempts, public.community_challenge_question_results,
  public.community_beta_feedback, public.community_campaign_events, public.community_external_metrics to service_role;
grant usage, select on sequence public.community_campaign_events_id_seq to service_role;

create or replace function public.complete_community_challenge(p_attempt_id uuid, p_score smallint, p_results jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare attempt public.community_challenge_attempts; existing_results jsonb;
begin
  select * into attempt from public.community_challenge_attempts where id = p_attempt_id for update;
  if not found then raise exception 'challenge_attempt_not_found'; end if;
  if attempt.expires_at < now() then raise exception 'challenge_attempt_expired'; end if;
  if attempt.completed_at is not null then
    select coalesce(jsonb_agg(jsonb_build_object('questionId', question_id, 'correct', is_correct) order by question_id), '[]'::jsonb)
      into existing_results from public.community_challenge_question_results where attempt_id = p_attempt_id;
    return jsonb_build_object('score', attempt.score, 'results', existing_results, 'duplicate', true);
  end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) <> 10 or p_score < 0 or p_score > 10 then raise exception 'invalid_challenge_result'; end if;
  update public.community_challenge_attempts set score = p_score, completed_at = now() where id = p_attempt_id;
  insert into public.community_challenge_question_results(attempt_id, question_id, is_correct)
    select p_attempt_id, x->>'questionId', (x->>'correct')::boolean from jsonb_array_elements(p_results) x;
  return jsonb_build_object('score', p_score, 'results', p_results, 'duplicate', false);
end;
$$;
revoke all on function public.complete_community_challenge(uuid, smallint, jsonb) from public, anon, authenticated;
grant execute on function public.complete_community_challenge(uuid, smallint, jsonb) to service_role;

create or replace function public.community_public_stats()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'challengeStarted', (select count(*) from public.community_challenge_attempts),
    'challengeCompleted', (select count(*) from public.community_challenge_attempts where completed_at is not null),
    'betaFeedback', (select count(*) from public.community_beta_feedback),
    'campaignViews', (select count(*) from public.community_campaign_events where event_type = 'campaign_view')
  );
$$;
revoke all on function public.community_public_stats() from public, anon, authenticated;
grant execute on function public.community_public_stats() to service_role;

create or replace function public.community_admin_stats()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'challengeStarted', (select count(*) from public.community_challenge_attempts),
    'challengeCompleted', (select count(*) from public.community_challenge_attempts where completed_at is not null),
    'challengeAverage', coalesce((select round(avg(score)::numeric, 2) from public.community_challenge_attempts where completed_at is not null), 0),
    'scoreDistribution', coalesce((select jsonb_object_agg(score::text, amount) from (select score, count(*) amount from public.community_challenge_attempts where completed_at is not null group by score) x), '{}'::jsonb),
    'questionStats', coalesce((select jsonb_agg(jsonb_build_object('questionId', question_id, 'answered', total, 'wrong', wrong, 'wrongRate', round(wrong::numeric * 100 / nullif(total,0), 1))) from (select question_id, count(*) total, count(*) filter (where not is_correct) wrong from public.community_challenge_question_results group by question_id) q), '[]'::jsonb),
    'betaCount', (select count(*) from public.community_beta_feedback),
    'betaAverage', coalesce((select round(avg((rating_ease + rating_clarity + rating_speed + rating_usefulness + rating_overall)::numeric / 5), 2) from public.community_beta_feedback), 0),
    'campaignViews', (select count(*) from public.community_campaign_events where event_type = 'campaign_view'),
    'campaignEvents', coalesce((select jsonb_object_agg(event_type, amount) from (select event_type, count(*) amount from public.community_campaign_events group by event_type) e), '{}'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', activity_date, 'challenge', challenge, 'beta', beta, 'campaign', campaign) order by activity_date) from (
      select activity_date, sum(challenge)::integer challenge, sum(beta)::integer beta, sum(campaign)::integer campaign from (
        select date_trunc('day', started_at)::date as activity_date, count(*)::integer challenge, 0 beta, 0 campaign from public.community_challenge_attempts group by 1
        union all select date_trunc('day', created_at)::date, 0, count(*)::integer, 0 from public.community_beta_feedback group by 1
        union all select date_trunc('day', created_at)::date, 0, 0, count(*)::integer from public.community_campaign_events group by 1
      ) d group by activity_date
    ) ds), '[]'::jsonb)
  );
$$;
revoke all on function public.community_admin_stats() from public, anon, authenticated;
grant execute on function public.community_admin_stats() to service_role;

create or replace function public.delete_expired_reports()
returns bigint language plpgsql security definer set search_path = public
as $$
declare deleted_count bigint := 0; affected_count bigint;
begin
  delete from public.reports where created_at < now() - interval '12 months';
  get diagnostics deleted_count = row_count;
  delete from public.community_challenge_attempts where started_at < now() - interval '12 months';
  get diagnostics affected_count = row_count; deleted_count := deleted_count + affected_count;
  delete from public.community_beta_feedback where created_at < now() - interval '12 months';
  get diagnostics affected_count = row_count; deleted_count := deleted_count + affected_count;
  delete from public.community_campaign_events where created_at < now() - interval '12 months';
  get diagnostics affected_count = row_count; deleted_count := deleted_count + affected_count;
  delete from public.community_external_metrics where created_at < now() - interval '12 months';
  get diagnostics affected_count = row_count; deleted_count := deleted_count + affected_count;
  return deleted_count;
end;
$$;

insert into public.community_challenge_questions(id, category, prompt, options, correct_option_id, explanation, safety_tip, sort_order) values
('bank-urgent', 'Giả danh ngân hàng', 'Bạn nhận tin nhắn: “Giao dịch bất thường, tài khoản sẽ bị khóa. Bấm liên kết để hủy ngay”. Bạn nên làm gì?', '[{"id":"a","text":"Bấm liên kết và đăng nhập để hủy"},{"id":"b","text":"Tự mở ứng dụng ngân hàng hoặc gọi số trên thẻ"},{"id":"c","text":"Trả lời tin nhắn để hỏi thêm"},{"id":"d","text":"Chuyển tiền sang tài khoản được hướng dẫn"}]', 'b', 'Tin nhắn khẩn cấp và liên kết đăng nhập có thể dẫn tới trang giả. Hãy tự mở ứng dụng hoặc gọi kênh chính thức.', 'Không dùng đường dẫn trong tin nhắn để đăng nhập hoặc nhập OTP.', 1),
('prize-fee', 'Trúng thưởng', 'Một trang báo bạn trúng quà nhưng phải trả “phí xác nhận” trước. Đây là dấu hiệu gì?', '[{"id":"a","text":"Phí nhỏ chứng minh giải thưởng có thật"},{"id":"b","text":"Yêu cầu trả tiền trước là dấu hiệu cần dừng và xác minh"},{"id":"c","text":"Chỉ cần kiểm tra trang có HTTPS"},{"id":"d","text":"Gửi mã OTP để nhận quà"}]', 'b', 'Yêu cầu phí trước để nhận giải có thể là cách chiếm đoạt tiền hoặc thông tin thanh toán.', 'Tự tìm chương trình trên kênh chính thức; không trả phí để nhận giải bất ngờ.', 2),
('facebook-lookalike', 'Tên miền gần giống', 'Địa chỉ nào cần kiểm tra kỹ hơn nếu trang tự nhận là Facebook?', '[{"id":"a","text":"https://www.facebook.com/"},{"id":"b","text":"https://facebook.com.example.test/"},{"id":"c","text":"Mở ứng dụng Facebook đã cài"},{"id":"d","text":"Tự gõ facebook.com vào thanh địa chỉ"}]', 'b', 'Trong facebook.com.example.test, tên miền đăng ký là example.test; chữ facebook chỉ nằm ở phần tên miền phụ.', 'Đọc hostname từ phải sang trái và xác minh trên tên miền chính thức.', 3),
('job-upfront', 'Tuyển dụng', 'Nhà tuyển dụng hứa việc nhẹ lương cao nhưng yêu cầu nộp tiền để “mở nhiệm vụ”. Cách an toàn là gì?', '[{"id":"a","text":"Nạp thử số tiền nhỏ"},{"id":"b","text":"Dừng và xác minh tin tuyển dụng qua kênh doanh nghiệp chính thức"},{"id":"c","text":"Gửi ảnh giấy tờ để giữ chỗ"},{"id":"d","text":"Vay tiền để hoàn thành nhiệm vụ"}]', 'b', 'Yêu cầu nạp tiền hoặc đặt cọc để được nhận việc là rủi ro cao và cần kiểm tra độc lập.', 'Không chuyển tiền để được tuyển dụng hoặc rút khoản “hoa hồng”.', 4),
('fake-org-email', 'Email giả mạo', 'Email “cơ quan” yêu cầu mở tệp đính kèm lạ và đăng nhập để cập nhật hồ sơ. Bạn nên làm gì?', '[{"id":"a","text":"Mở tệp và đăng nhập ngay"},{"id":"b","text":"Kiểm tra địa chỉ người gửi và liên hệ cơ quan qua kênh tự tìm"},{"id":"c","text":"Chuyển tiếp email cho mọi người"},{"id":"d","text":"Tắt phần mềm bảo vệ để mở tệp"}]', 'b', 'Tên hiển thị có thể bị giả. Tệp và trang đăng nhập cần được xác minh qua kênh độc lập.', 'Không mở tệp hoặc đăng nhập từ liên kết bất ngờ trước khi xác minh.', 5),
('qr-payment', 'Mã QR', 'Bạn thấy mã QR dán đè lên mã thanh toán tại quầy. Nên kiểm tra gì trước khi trả tiền?', '[{"id":"a","text":"Chuyển tiền nếu tên người nhận gần giống cửa hàng"},{"id":"b","text":"Xác nhận tên người nhận và số tiền với nhân viên"},{"id":"c","text":"Quét mã rồi nhập OTP vào trang mở ra"},{"id":"d","text":"Tin rằng mã QR ở nơi công cộng luôn an toàn"}]', 'b', 'Mã QR có thể dẫn tới tài khoản hoặc website khác. Kiểm tra đích đến và người nhận trước khi xác nhận.', 'Xác nhận người nhận và số tiền; không nhập mật khẩu hoặc OTP ở trang lạ.', 6),
('short-link', 'Liên kết rút gọn', 'Một người lạ gửi liên kết rút gọn kèm lời nhắn “xem ngay”. Bạn nên làm gì?', '[{"id":"a","text":"Mở ngay vì liên kết ngắn dễ nhớ"},{"id":"b","text":"Hỏi lại người gửi qua kênh tin cậy hoặc không mở nếu không rõ nguồn"},{"id":"c","text":"Nhập mật khẩu để xem nội dung"},{"id":"d","text":"Chuyển liên kết cho bạn bè thử"}]', 'b', 'Liên kết rút gọn che khuất đích đến và lời nhắn thúc giục khiến việc kiểm tra khó hơn.', 'Xác minh người gửi và đích đến bằng công cụ đáng tin cậy trước khi mở.', 7),
('tech-support', 'Hỗ trợ kỹ thuật', 'Người tự xưng hỗ trợ kỹ thuật gọi điện, yêu cầu cài ứng dụng điều khiển từ xa để “sửa lỗi”. Nên làm gì?', '[{"id":"a","text":"Cài ứng dụng và đọc mã xác thực cho họ"},{"id":"b","text":"Từ chối, ngắt cuộc gọi và gọi số hỗ trợ chính thức"},{"id":"c","text":"Cho họ xem màn hình ngân hàng"},{"id":"d","text":"Gửi mật khẩu để tiết kiệm thời gian"}]', 'b', 'Ứng dụng điều khiển từ xa có thể cho người khác quyền xem hoặc thao tác thiết bị.', 'Không chia sẻ mã truy cập; tự gọi bộ phận hỗ trợ qua kênh chính thức.', 8),
('domain-boundary', 'Tên miền', 'Trong địa chỉ https://paypa1.example.test/login, phần nào là tên miền chính?', '[{"id":"a","text":"paypa1"},{"id":"b","text":"example.test"},{"id":"c","text":"login"},{"id":"d","text":"https"}]', 'b', 'Tên miền đăng ký là example.test; paypa1 chỉ là tên miền phụ và có thể được đặt tùy ý.', 'Xác định tên miền chính trước khi nhập thông tin.', 9),
('https-lock', 'HTTPS', 'Biểu tượng ổ khóa và HTTPS cho bạn biết điều gì?', '[{"id":"a","text":"Website chắc chắn thuộc ngân hàng"},{"id":"b","text":"Kết nối được mã hóa, nhưng không chứng minh website đáng tin"},{"id":"c","text":"Trang không thể lấy cắp thông tin"},{"id":"d","text":"Tên miền đã được cơ quan nhà nước xác minh"}]', 'b', 'HTTPS bảo vệ đường truyền, nhưng website lừa đảo cũng có thể sử dụng chứng chỉ HTTPS.', 'Kiểm tra tên miền và xác minh tổ chức riêng, không chỉ dựa vào ổ khóa.', 10),
('shop-payment', 'Thương mại điện tử', 'Một cửa hàng trực tuyến chỉ nhận chuyển khoản cá nhân và thúc giục trả tiền ngay để giữ giá. Bạn nên làm gì?', '[{"id":"a","text":"Chuyển tiền vì giá rẻ có thời hạn"},{"id":"b","text":"Tìm thông tin cửa hàng từ nguồn độc lập và kiểm tra chính sách thanh toán"},{"id":"c","text":"Gửi ảnh thẻ ngân hàng qua chat"},{"id":"d","text":"Bỏ qua tên tài khoản người nhận"}]', 'b', 'Giá quá tốt, thúc giục và phương thức thanh toán thiếu bảo vệ là các tín hiệu cần xác minh.', 'Không vội chuyển khoản; kiểm tra đơn vị bán và phương thức thanh toán.', 11),
('account-otp', 'Chiếm đoạt tài khoản', 'Người gọi tự xưng nhân viên hỗ trợ yêu cầu bạn đọc mã OTP để hủy giao dịch. Cách xử lý đúng?', '[{"id":"a","text":"Đọc mã nếu họ biết tên bạn"},{"id":"b","text":"Không chia sẻ OTP; tự gọi ngân hàng qua số chính thức"},{"id":"c","text":"Gửi OTP qua tin nhắn thay vì đọc"},{"id":"d","text":"Chụp màn hình mã gửi cho họ"}]', 'b', 'OTP có thể xác nhận đăng nhập hoặc giao dịch. Nhân viên thật không cần bạn đọc mã để hủy giao dịch.', 'Không cung cấp OTP, mật khẩu hay mã khôi phục cho bất kỳ ai.', 12),
('urgent-attachment', 'Email và tệp đính kèm', 'Email lạ nói hóa đơn sẽ bị phạt nếu không mở tệp nén trong 10 phút. Bước an toàn nhất?', '[{"id":"a","text":"Mở tệp để tránh bị phạt"},{"id":"b","text":"Không mở; kiểm tra hóa đơn qua cổng chính thức tự truy cập"},{"id":"c","text":"Bật macro để đọc hóa đơn"},{"id":"d","text":"Gửi lại email kèm mật khẩu"}]', 'b', 'Đe dọa và thời hạn gấp là cách gây áp lực; tệp lạ có thể chứa mã độc.', 'Tự truy cập cổng chính thức hoặc liên hệ đơn vị phát hành bằng thông tin đã biết.', 13),
('investment-withdraw', 'Đầu tư trực tuyến', 'Ứng dụng đầu tư hiển thị lợi nhuận nhưng yêu cầu nộp “thuế rút tiền” vào tài khoản cá nhân. Nên làm gì?', '[{"id":"a","text":"Nộp tiền để lấy lại vốn"},{"id":"b","text":"Dừng chuyển tiền, xác minh giấy phép và hỏi cơ quan quản lý"},{"id":"c","text":"Vay thêm vì lợi nhuận đã hiện"},{"id":"d","text":"Tin ảnh chụp lợi nhuận trong nhóm chat"}]', 'b', 'Số dư trên màn hình không chứng minh tiền có thể rút; phí nộp thêm để rút tiền là dấu hiệu đáng ngờ.', 'Không gửi thêm tiền trước khi xác minh độc lập nền tảng và đơn vị quản lý.', 14),
('account-recovery', 'Bảo vệ tài khoản', 'Bạn nhập mật khẩu vào một trang nghi giả mạo rồi nhận ra ngay. Nên làm gì trước?', '[{"id":"a","text":"Chờ xem có chuyện gì xảy ra"},{"id":"b","text":"Đổi mật khẩu từ ứng dụng/trang chính thức và bật xác thực nhiều lớp"},{"id":"c","text":"Dùng lại mật khẩu đó ở nơi khác"},{"id":"d","text":"Gửi mã khôi phục cho người hỗ trợ"}]', 'b', 'Đổi mật khẩu từ kênh chính thức giúp giảm nguy cơ bị chiếm tài khoản; kiểm tra phiên đăng nhập và liên hệ nhà cung cấp.', 'Đổi mật khẩu bị lộ, đăng xuất phiên lạ và không chia sẻ mã khôi phục.', 15)
on conflict (id) do nothing;
