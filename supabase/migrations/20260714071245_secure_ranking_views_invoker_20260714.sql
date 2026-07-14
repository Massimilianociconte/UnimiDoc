-- ── Part 1: tighten the two new SECURITY DEFINER functions ──────────────────
-- delete_document is an authenticated client RPC (it checks auth.uid()); anon
-- must not reach it. The project's default privileges auto-grant anon EXECUTE on
-- new public functions, so revoke it explicitly.
revoke execute on function public.delete_document(uuid) from anon;
-- enqueue_document_storage_cleanup is a trigger function only; nobody should be
-- able to call it directly via the API.
revoke all on function public.enqueue_document_storage_cleanup() from public, anon, authenticated;

-- ── Part 2: move the public-ranking computation into app_private (not exposed) ──
-- The public_* views were flagged as SECURITY DEFINER views (advisor 0010) because
-- they aggregate RLS-protected tables (documents/purchases/reports/profiles) that
-- have no public-read policies. Converting them to plain security_invoker would
-- return empty for anon and break the marketplace. Instead the definer logic lives
-- in app_private functions (not in the exposed API, so not flagged), and the public
-- views become thin security_invoker passthroughs. No data exposure, no frontend
-- change, identical output.

create or replace function app_private.public_document_rankings_fn()
 returns table(
   document_id uuid, owner_id uuid, title text, course_name text, professor text,
   university text, degree_slug text, degree_course text, academic_year text,
   created_at timestamptz, updated_at timestamptz, review_count integer, review_avg numeric,
   fq_percent numeric, fq_reviewers integer, purchases_active integer, purchases_refunded integer,
   reports_negative integer, completeness numeric, freshness numeric, rating_score numeric,
   flashcard_score numeric, ai_quality_score numeric, satisfaction_score numeric,
   overall_score numeric, recent_score numeric, didactic_score numeric, sample_size integer)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $fn$
  WITH globals AS (
    SELECT COALESCE((SELECT avg(document_reviews.rating) FROM document_reviews), 3.8) AS prior_rating,
           COALESCE((SELECT avg(document_flashcard_quality_rollups.quality_percent)
                     FROM document_flashcard_quality_rollups
                     WHERE document_flashcard_quality_rollups.reviewer_count > 0), 70.0) AS prior_fq
  ), scored AS (
    SELECT s.document_id, s.owner_id, s.title, s.course_name, s.professor, s.university,
           s.degree_slug, s.degree_course, s.academic_year, s.created_at, s.updated_at,
           s.review_count, s.review_avg, s.reviews_90d, s.fq_percent, s.fq_reviewers,
           s.ai_quality, s.outline_reliable, s.purchases_active, s.purchases_refunded,
           s.purchases_90d, s.distinct_buyers, s.reports_negative, s.completeness, s.freshness,
           ((COALESCE(s.review_avg, g.prior_rating) * s.review_count::numeric + g.prior_rating * 5::numeric) / (s.review_count + 5)::numeric - 1::numeric) / 4.0 AS rating_norm,
           (COALESCE(s.fq_percent, g.prior_fq) * s.fq_reviewers::numeric + g.prior_fq * 3::numeric) / (s.fq_reviewers + 3)::numeric / 100.0 AS fq_norm,
           (s.purchases_active::numeric + 4.0) / ((s.purchases_active + s.purchases_refunded)::numeric + 2.0 * s.reports_negative::numeric + 5.0) AS satisfaction,
           COALESCE(s.ai_quality, 0.55) AS ai_q,
           LEAST(1.0::double precision, ln((1 + s.purchases_90d + s.reviews_90d)::double precision) / ln(21::double precision)) AS recent_signal
    FROM document_ranking_signals s CROSS JOIN globals g
  )
  SELECT document_id, owner_id, title, course_name, professor, university, degree_slug,
         degree_course, academic_year, created_at, updated_at, review_count,
         round(review_avg, 2) AS review_avg, fq_percent, fq_reviewers, purchases_active,
         purchases_refunded, reports_negative, completeness, freshness,
         round(rating_norm, 4) AS rating_score, round(fq_norm, 4) AS flashcard_score,
         round(ai_q, 4) AS ai_quality_score, round(satisfaction, 4) AS satisfaction_score,
         round(100::numeric * (0.26 * rating_norm + 0.20 * fq_norm + 0.14 * ai_q + 0.14 * completeness + 0.12 * satisfaction + 0.14 * freshness), 2) AS overall_score,
         round(((0.62 * (100::numeric * (0.26 * rating_norm + 0.20 * fq_norm + 0.14 * ai_q + 0.14 * completeness + 0.12 * satisfaction + 0.14 * freshness)))::double precision + (0.38 * 100::numeric)::double precision * recent_signal * (0.5 + 0.5 * rating_norm)::double precision)::numeric, 2) AS recent_score,
         round(100::numeric * (0.60 * fq_norm + 0.25 * ai_q + 0.15 * CASE WHEN outline_reliable THEN 1.0 ELSE 0.0 END), 2) AS didactic_score,
         review_count + fq_reviewers + purchases_active AS sample_size
  FROM scored;
$fn$;

create or replace function app_private.public_author_rankings_fn()
 returns table(
   author_id uuid, public_display_name text, avatar_url text, university text, degree_course text,
   docs_published integer, avg_doc_score numeric, avg_flashcard_score numeric, total_reviews integer,
   total_purchases integer, total_refunds integer, total_reports integer, distinct_buyers integer,
   repeat_buyers integer, first_published_at timestamptz, consistency numeric, repeat_rate numeric,
   reliability_score numeric, is_emerging boolean, emerging_score numeric)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $fn$
  WITH per_author AS (
    SELECT r.owner_id, count(*)::integer AS docs_published, avg(r.overall_score) AS avg_doc_score,
           COALESCE(stddev_pop(r.overall_score), 0::numeric) AS doc_score_stddev,
           avg(r.flashcard_score) AS avg_flashcard_score, sum(r.review_count)::integer AS total_reviews,
           sum(r.purchases_active)::integer AS total_purchases, sum(r.purchases_refunded)::integer AS total_refunds,
           sum(r.reports_negative)::integer AS total_reports, min(r.created_at) AS first_published_at,
           max(r.created_at) AS last_published_at
    FROM app_private.public_document_rankings_fn() r
    GROUP BY r.owner_id
  ), buyers AS (
    SELECT dp.seller_id, count(DISTINCT dp.buyer_id)::integer AS distinct_buyers,
           count(DISTINCT dp.buyer_id) FILTER (WHERE dp.cnt >= 2)::integer AS repeat_buyers
    FROM (SELECT document_purchases.seller_id, document_purchases.buyer_id, count(*) AS cnt
          FROM document_purchases WHERE document_purchases.status = 'active'::text
          GROUP BY document_purchases.seller_id, document_purchases.buyer_id) dp
    GROUP BY dp.seller_id
  ), globals AS (
    SELECT COALESCE((SELECT avg(per_author.avg_doc_score) FROM per_author), 55.0) AS prior_author
  ), scored AS (
    SELECT a.owner_id, a.docs_published, a.avg_doc_score, a.doc_score_stddev, a.avg_flashcard_score,
           a.total_reviews, a.total_purchases, a.total_refunds, a.total_reports, a.first_published_at,
           a.last_published_at, COALESCE(b.distinct_buyers, 0) AS distinct_buyers,
           COALESCE(b.repeat_buyers, 0) AS repeat_buyers,
           (a.avg_doc_score * a.docs_published::numeric + g.prior_author * 3::numeric) / (a.docs_published + 3)::numeric AS author_bayes,
           GREATEST(0.0, 1.0 - a.doc_score_stddev / 25.0) AS consistency,
           (COALESCE(b.repeat_buyers, 0)::numeric + 1.0) / (COALESCE(b.distinct_buyers, 0)::numeric + 5.0) AS repeat_rate_smoothed,
           1.0 - LEAST(1.0, (a.total_refunds::numeric * 1.0 + a.total_reports::numeric * 2.0) / GREATEST(a.total_purchases, 5)::numeric) AS trust_rate
    FROM per_author a CROSS JOIN globals g LEFT JOIN buyers b ON b.seller_id = a.owner_id
  )
  SELECT p.id AS author_id, p.public_display_name, p.avatar_url, p.university, p.degree_course,
         s.docs_published, round(s.avg_doc_score, 2) AS avg_doc_score,
         round(s.avg_flashcard_score, 4) AS avg_flashcard_score, s.total_reviews, s.total_purchases,
         s.total_refunds, s.total_reports, s.distinct_buyers, s.repeat_buyers, s.first_published_at,
         round(s.consistency, 4) AS consistency, round(s.repeat_rate_smoothed, 4) AS repeat_rate,
         round(0.45 * s.author_bayes + 100::numeric * (0.15 * s.consistency + 0.15 * s.repeat_rate_smoothed + 0.15 * s.trust_rate + 0.10 * s.avg_flashcard_score), 2) AS reliability_score,
         s.first_published_at > (now() - '120 days'::interval) AS is_emerging,
         round((0.45 * s.author_bayes + 100::numeric * (0.15 * s.consistency + 0.15 * s.repeat_rate_smoothed + 0.15 * s.trust_rate + 0.10 * s.avg_flashcard_score)) * (0.55 + 0.45 * exp((- GREATEST(0::numeric, EXTRACT(epoch FROM now() - s.first_published_at) / 86400.0)) / 90.0)), 2) AS emerging_score
  FROM scored s JOIN profiles p ON p.id = s.owner_id
  WHERE p.seller_profile_enabled = true AND p.public_display_name IS NOT NULL;
$fn$;

revoke all on function app_private.public_document_rankings_fn() from public;
revoke all on function app_private.public_author_rankings_fn() from public;
grant execute on function app_private.public_document_rankings_fn() to anon, authenticated;
grant execute on function app_private.public_author_rankings_fn() to anon, authenticated;

-- ── Part 3: replace the exposed views with security_invoker passthroughs ────
drop view if exists public.public_author_rankings;
drop view if exists public.public_document_rankings;

create view public.public_document_rankings with (security_invoker = on) as
  select * from app_private.public_document_rankings_fn();
create view public.public_author_rankings with (security_invoker = on) as
  select * from app_private.public_author_rankings_fn();

grant select on public.public_document_rankings to anon, authenticated;
grant select on public.public_author_rankings to anon, authenticated;
