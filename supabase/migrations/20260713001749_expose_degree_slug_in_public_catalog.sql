-- Keep the public catalog aligned with documents.degree_slug so the frontend
-- can filter materials by the canonical UniMi degree-program identifier.
create or replace view public.public_document_catalog
with (security_barrier = true, security_invoker = true)
as
select
  document.id,
  case
    when profile.seller_profile_enabled and profile.public_display_name is not null
      then document.owner_id
    else null::uuid
  end as seller_id,
  document.title,
  document.course_name,
  document.professor,
  document.academic_year,
  document.page_count,
  document.language,
  document.preview_policy,
  document.description,
  document.exam_type,
  document.semester,
  document.degree_course,
  document.university,
  document.tags,
  document.compatible_exams,
  document.insights,
  document.price_credits,
  quality.quality_percent as flashcard_quality_percent,
  quality.reviewer_count as flashcard_reviewer_count,
  document.created_at,
  document.updated_at,
  document.degree_slug
from public.documents as document
join public.profiles as profile on profile.id = document.owner_id
left join public.document_flashcard_quality_rollups as quality on quality.document_id = document.id
where document.visibility = 'published';

revoke all on public.public_document_catalog from public;
grant select on public.public_document_catalog to anon, authenticated;
