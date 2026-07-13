-- GIN index for fast hybrid keyword search in RAG
-- This speeds up ts_rank / to_tsvector usage inside match_rag_chunks when query_text is provided.

-- Expression index on simple tsvector (lightweight and effective for academic content)
create index if not exists pdf_chunks_content_tsv_gin
  on public.pdf_chunks
  using gin (to_tsvector('simple', content));

-- Optional stronger Italian config index (uncomment if you want language-aware ranking)
-- create index if not exists pdf_chunks_content_tsv_italian_gin
--   on public.pdf_chunks
--   using gin (to_tsvector('italian', content));

comment on index pdf_chunks_content_tsv_gin is 
'Expression GIN index to accelerate hybrid vector+keyword retrieval in match_rag_chunks (RAG).';

-- Also ensure we have good indexes on the embeddings table for the common filters
create index if not exists rag_chunk_embeddings_model_version_status_idx
  on public.rag_chunk_embeddings (embedding_model, embedding_version, embedding_status)
  where embedding_status = 'embedded';

create index if not exists rag_chunk_embeddings_doc_model_version_idx
  on public.rag_chunk_embeddings (document_id, embedding_model, embedding_version);