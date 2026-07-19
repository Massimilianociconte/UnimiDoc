-- Analytics di prodotto first-party (nessun cookie di terze parti, nessuna
-- profilazione): estende la whitelist degli eventi minimi. La lettura resta
-- riservata al service role; retention 180 giorni già attiva via pg_cron.
alter table public.usage_events drop constraint usage_events_event_check;
alter table public.usage_events add constraint usage_events_event_check check (event in (
  'document_preview', 'document_download', 'document_open',
  'search', 'search_no_results', 'degree_page_view',
  'signup_completed', 'upload_completed', 'document_purchased',
  'flashcards_generated', 'study_session_completed', 'premium_conversion',
  'ocr_used', 'rag_query_used', 'image_occlusion_used'
));
