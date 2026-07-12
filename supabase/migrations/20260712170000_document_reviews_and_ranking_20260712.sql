-- Recensioni, segnalazioni e ranking multi-segnale di documenti e autori.
--
-- Principi (vedi anche src/lib/ranking.ts, che replica le stesse formule sul
-- catalogo demo):
--  * nessuna classifica basata su un solo contatore: ogni punteggio combina
--    recensioni, qualità didattica delle flashcard, qualità AI del PDF,
--    completezza dei metadati, soddisfazione d'acquisto e freschezza;
--  * medie bayesiane con soglia minima di campioni (m): pochi voti vengono
--    attratti verso il prior globale e non scavalcano contenuti consolidati;
--  * correttivi temporali: decay esponenziale su aggiornamento e anno
--    accademico, finestra recente (90 giorni) per i trend;
--  * volume mai additivo: il numero di vendite/documenti entra solo come
--    confidenza (n dentro la media bayesiana) o con rendimento decrescente.

-- ---------------------------------------------------------------------------
-- 1) Recensioni dei documenti (1-5) — solo acquirenti reali o lettori di
--    documenti gratuiti pubblicati; mai l'autore. Una recensione per utente.
-- ---------------------------------------------------------------------------
create table if not exists public.document_reviews (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, reviewer_id)
);

create index if not exists document_reviews_document_idx on public.document_reviews (document_id);
create index if not exists document_reviews_reviewer_idx on public.document_reviews (reviewer_id);

alter table public.document_reviews enable row level security;

drop policy if exists document_reviews_select on public.document_reviews;
create policy document_reviews_select on public.document_reviews
  for select to anon, authenticated using (
    reviewer_id = auth.uid()
    or exists (
      select 1 from public.documents d
      where d.id = document_reviews.document_id and d.visibility = 'published'
    )
  );

drop policy if exists document_reviews_insert on public.document_reviews;
create policy document_reviews_insert on public.document_reviews
  for insert to authenticated with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.documents d
      where d.id = document_reviews.document_id
        and d.visibility = 'published'
        and d.owner_id <> auth.uid()
    )
    and (
      exists (
        select 1 from public.document_purchases p
        where p.document_id = document_reviews.document_id
          and p.buyer_id = auth.uid()
          and p.status = 'active'
      )
      or exists (
        select 1 from public.documents d
        where d.id = document_reviews.document_id and coalesce(d.price_credits, 0) = 0
      )
    )
  );

drop policy if exists document_reviews_update on public.document_reviews;
create policy document_reviews_update on public.document_reviews
  for update to authenticated
  using (reviewer_id = auth.uid())
  with check (reviewer_id = auth.uid());

drop policy if exists document_reviews_delete on public.document_reviews;
create policy document_reviews_delete on public.document_reviews
  for delete to authenticated using (reviewer_id = auth.uid());

revoke all on public.document_reviews from anon, authenticated;
grant select on public.document_reviews to anon, authenticated;
grant insert, update, delete on public.document_reviews to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Segnalazioni degli utenti — una per utente per documento; lette e gestite
--    solo dalla moderazione (service role). Erodono i punteggi quando aperte
--    o accolte.
-- ---------------------------------------------------------------------------
create table if not exists public.document_reports (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('contenuto_errato', 'copyright', 'spam', 'metadati_ingannevoli', 'altro')),
  details text check (details is null or char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'dismissed', 'upheld')),
  created_at timestamptz not null default now(),
  unique (document_id, reporter_id)
);

create index if not exists document_reports_document_idx on public.document_reports (document_id);
create index if not exists document_reports_reporter_idx on public.document_reports (reporter_id);

alter table public.document_reports enable row level security;

drop policy if exists document_reports_select_own on public.document_reports;
create policy document_reports_select_own on public.document_reports
  for select to authenticated using (reporter_id = auth.uid());

drop policy if exists document_reports_insert on public.document_reports;
create policy document_reports_insert on public.document_reports
  for insert to authenticated with check (
    reporter_id = auth.uid()
    and exists (
      select 1 from public.documents d
      where d.id = document_reports.document_id
        and d.visibility = 'published'
        and d.owner_id <> auth.uid()
    )
  );

revoke all on public.document_reports from anon, authenticated;
grant select, insert on public.document_reports to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Segnali per documento (vista interna, nessun grant client).
--    Le viste di ranking girano come owner (pattern di public_document_catalog)
--    e espongono SOLO documenti pubblicati e venditori con profilo pubblico.
-- ---------------------------------------------------------------------------
create or replace view public.document_ranking_signals as
select
  d.id as document_id,
  d.owner_id,
  d.title,
  d.course_name,
  d.professor,
  d.university,
  d.degree_slug,
  d.degree_course,
  d.academic_year,
  d.created_at,
  d.updated_at,
  -- recensioni
  coalesce(r.review_count, 0) as review_count,
  r.review_avg,
  coalesce(r.reviews_90d, 0) as reviews_90d,
  -- qualità didattica (voti community sulle flashcard del documento)
  q.quality_percent as fq_percent,
  coalesce(q.reviewer_count, 0) as fq_reviewers,
  -- qualità AI del PDF (pipeline: leggibilità, OCR, indice affidabile)
  case
    when dq.overall_score is null then null
    when dq.overall_score > 1 then least(1.0, dq.overall_score / 100.0)
    else greatest(0.0, dq.overall_score)
  end as ai_quality,
  coalesce(dq.outline_reliable, false) as outline_reliable,
  -- acquisti e rimborsi
  coalesce(p.purchases_active, 0) as purchases_active,
  coalesce(p.purchases_refunded, 0) as purchases_refunded,
  coalesce(p.purchases_90d, 0) as purchases_90d,
  coalesce(p.distinct_buyers, 0) as distinct_buyers,
  -- segnalazioni aperte o accolte
  coalesce(rep.reports_negative, 0) as reports_negative,
  -- completezza dei metadati (0..1, checklist deterministica)
  round((
    (case when char_length(coalesce(d.description, '')) >= 80 then 0.20 else 0.0 end)
    + (case when coalesce(array_length(d.tags, 1), 0) >= 3 then 0.15 else 0.0 end)
    + (case when coalesce(d.professor, '') <> '' then 0.15 else 0.0 end)
    + (case when coalesce(d.academic_year, '') ~ '^\d{4}' then 0.10 else 0.0 end)
    + (case when coalesce(d.exam_type, '') <> '' then 0.10 else 0.0 end)
    + (case when coalesce(d.semester, '') <> '' then 0.10 else 0.0 end)
    + (case when d.degree_slug is not null then 0.10 else 0.0 end)
    + (case when coalesce(d.page_count, 0) > 0 then 0.10 else 0.0 end)
  )::numeric, 3) as completeness,
  -- freschezza: decay sull'ultimo aggiornamento x fattore anno accademico
  round((
    exp(-greatest(0, extract(epoch from (now() - d.updated_at)) / 86400.0) / 365.0)
    * greatest(0.55, 1.0 - 0.15 * greatest(0,
        (extract(year from now())::int - case when extract(month from now()) >= 9 then 0 else 1 end)
        - coalesce(nullif(substring(coalesce(d.academic_year, ''), '^\d{4}'), '')::int,
                   (extract(year from now())::int - case when extract(month from now()) >= 9 then 0 else 1 end) - 2)
      ))
  )::numeric, 4) as freshness
from public.documents d
left join lateral (
  select count(*)::int as review_count,
         avg(rating)::numeric as review_avg,
         count(*) filter (where created_at > now() - interval '90 days')::int as reviews_90d
  from public.document_reviews dr where dr.document_id = d.id
) r on true
left join public.document_flashcard_quality_rollups q on q.document_id = d.id
left join public.document_quality_reports dq on dq.document_id = d.id
left join lateral (
  select count(*) filter (where dp.status = 'active')::int as purchases_active,
         count(*) filter (where dp.status in ('refunded', 'revoked'))::int as purchases_refunded,
         count(*) filter (where dp.status = 'active' and dp.created_at > now() - interval '90 days')::int as purchases_90d,
         count(distinct dp.buyer_id)::int as distinct_buyers
  from public.document_purchases dp where dp.document_id = d.id
) p on true
left join lateral (
  select count(*) filter (where drp.status in ('open', 'reviewing', 'upheld'))::int as reports_negative
  from public.document_reports drp where drp.document_id = d.id
) rep on true
where d.visibility = 'published';

revoke all on public.document_ranking_signals from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Ranking pubblico dei documenti.
--    Componenti tutte 0..1, punteggi 0..100. Prior globali calcolati sul
--    catalogo con fallback neutro quando i dati sono pochi.
-- ---------------------------------------------------------------------------
create or replace view public.public_document_rankings as
with globals as (
  select
    coalesce((select avg(rating)::numeric from public.document_reviews), 3.8) as prior_rating,
    coalesce((select avg(quality_percent)::numeric from public.document_flashcard_quality_rollups where reviewer_count > 0), 70.0) as prior_fq
),
scored as (
  select
    s.*,
    -- media bayesiana recensioni (m = 5 recensioni di soglia), normalizzata 0..1
    ((coalesce(s.review_avg, g.prior_rating) * s.review_count + g.prior_rating * 5)
      / (s.review_count + 5) - 1) / 4.0 as rating_norm,
    -- media bayesiana qualità flashcard (m = 3 revisori), 0..1
    ((coalesce(s.fq_percent, g.prior_fq) * s.fq_reviewers + g.prior_fq * 3)
      / (s.fq_reviewers + 3)) / 100.0 as fq_norm,
    -- soddisfazione: acquisti attivi vs rimborsi e segnalazioni, smoothing
    -- di Laplace con prior 0.8 (4/5) così pochi eventi non azzerano il segnale
    (s.purchases_active + 4.0)
      / (s.purchases_active + s.purchases_refunded + 2.0 * s.reports_negative + 5.0) as satisfaction,
    coalesce(s.ai_quality, 0.55) as ai_q,
    -- trend recente: log-saturazione dei segnali a 90 giorni (mai lineare)
    least(1.0, ln(1 + s.purchases_90d + s.reviews_90d) / ln(21)) as recent_signal
  from public.document_ranking_signals s
  cross join globals g
)
select
  document_id,
  owner_id,
  title,
  course_name,
  professor,
  university,
  degree_slug,
  degree_course,
  academic_year,
  created_at,
  updated_at,
  review_count,
  round(review_avg, 2) as review_avg,
  fq_percent,
  fq_reviewers,
  purchases_active,
  purchases_refunded,
  reports_negative,
  completeness,
  freshness,
  round(rating_norm::numeric, 4) as rating_score,
  round(fq_norm::numeric, 4) as flashcard_score,
  round(ai_q::numeric, 4) as ai_quality_score,
  round(satisfaction::numeric, 4) as satisfaction_score,
  -- punteggio complessivo: nessun contatore lineare, volume solo come confidenza
  round((100 * (
    0.26 * rating_norm + 0.20 * fq_norm + 0.14 * ai_q
    + 0.14 * completeness + 0.12 * satisfaction + 0.14 * freshness
  ))::numeric, 2) as overall_score,
  -- "apprezzati di recente": base qualitativa + trend, gate sulla qualità
  round((
    0.62 * (100 * (
      0.26 * rating_norm + 0.20 * fq_norm + 0.14 * ai_q
      + 0.14 * completeness + 0.12 * satisfaction + 0.14 * freshness
    ))
    + 0.38 * 100 * recent_signal * (0.5 + 0.5 * rating_norm)
  )::numeric, 2) as recent_score,
  -- qualità didattica: flashcard votate dalla community + qualità AI + indice
  round((100 * (
    0.60 * fq_norm + 0.25 * ai_q + 0.15 * (case when outline_reliable then 1.0 else 0.0 end)
  ))::numeric, 2) as didactic_score,
  (review_count + fq_reviewers + purchases_active) as sample_size
from scored;

revoke all on public.public_document_rankings from anon, authenticated;
grant select on public.public_document_rankings to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) Ranking pubblico degli autori (solo profili venditore pubblici).
-- ---------------------------------------------------------------------------
create or replace view public.public_author_rankings as
with per_author as (
  select
    r.owner_id,
    count(*)::int as docs_published,
    avg(r.overall_score)::numeric as avg_doc_score,
    coalesce(stddev_pop(r.overall_score), 0)::numeric as doc_score_stddev,
    avg(r.flashcard_score)::numeric as avg_flashcard_score,
    sum(r.review_count)::int as total_reviews,
    sum(r.purchases_active)::int as total_purchases,
    sum(r.purchases_refunded)::int as total_refunds,
    sum(r.reports_negative)::int as total_reports,
    min(r.created_at) as first_published_at,
    max(r.created_at) as last_published_at
  from public.public_document_rankings r
  group by r.owner_id
),
buyers as (
  select dp.seller_id,
         count(distinct dp.buyer_id)::int as distinct_buyers,
         count(distinct dp.buyer_id) filter (where cnt >= 2)::int as repeat_buyers
  from (
    select seller_id, buyer_id, count(*) as cnt
    from public.document_purchases
    where status = 'active'
    group by seller_id, buyer_id
  ) dp
  group by dp.seller_id
),
globals as (
  select coalesce((select avg(avg_doc_score) from per_author), 55.0) as prior_author
),
scored as (
  select
    a.*,
    coalesce(b.distinct_buyers, 0) as distinct_buyers,
    coalesce(b.repeat_buyers, 0) as repeat_buyers,
    -- bayes sul punteggio medio dei documenti (K = 3 documenti di soglia):
    -- il rapporto quantità/qualità premia la media, non il numero di upload
    (a.avg_doc_score * a.docs_published + g.prior_author * 3) / (a.docs_published + 3) as author_bayes,
    -- costanza qualitativa: deviazione standard penalizzata
    greatest(0.0, 1.0 - a.doc_score_stddev / 25.0) as consistency,
    -- fedeltà: quota di acquirenti che ricomprano, smoothing di Laplace
    (coalesce(b.repeat_buyers, 0) + 1.0) / (coalesce(b.distinct_buyers, 0) + 5.0) as repeat_rate_smoothed,
    -- affidabilità commerciale: rimborsi e segnalazioni erodono
    1.0 - least(1.0, (a.total_refunds * 1.0 + a.total_reports * 2.0) / greatest(a.total_purchases, 5)) as trust_rate
  from per_author a
  cross join globals g
  left join buyers b on b.seller_id = a.owner_id
)
select
  p.id as author_id,
  p.public_display_name,
  p.avatar_url,
  p.university,
  p.degree_course,
  s.docs_published,
  round(s.avg_doc_score, 2) as avg_doc_score,
  round(s.avg_flashcard_score, 4) as avg_flashcard_score,
  s.total_reviews,
  s.total_purchases,
  s.total_refunds,
  s.total_reports,
  s.distinct_buyers,
  s.repeat_buyers,
  s.first_published_at,
  round(s.consistency::numeric, 4) as consistency,
  round(s.repeat_rate_smoothed::numeric, 4) as repeat_rate,
  round((
    0.45 * s.author_bayes
    + 100 * (0.15 * s.consistency + 0.15 * s.repeat_rate_smoothed + 0.15 * s.trust_rate + 0.10 * s.avg_flashcard_score)
  )::numeric, 2) as reliability_score,
  (s.first_published_at > now() - interval '120 days') as is_emerging,
  -- autori emergenti: stessa qualità, bonus di novità che decade in ~90 giorni
  round(((
    0.45 * s.author_bayes
    + 100 * (0.15 * s.consistency + 0.15 * s.repeat_rate_smoothed + 0.15 * s.trust_rate + 0.10 * s.avg_flashcard_score)
  ) * (0.55 + 0.45 * exp(-greatest(0, extract(epoch from (now() - s.first_published_at)) / 86400.0) / 90.0)))::numeric, 2) as emerging_score
from scored s
join public.profiles p on p.id = s.owner_id
where p.seller_profile_enabled = true and p.public_display_name is not null;

revoke all on public.public_author_rankings from anon, authenticated;
grant select on public.public_author_rankings to anon, authenticated;
