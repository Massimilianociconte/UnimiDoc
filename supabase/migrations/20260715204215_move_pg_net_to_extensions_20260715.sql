-- Advisor 0014 (extension_in_public): pg_net 0.20 non è rilocabile con ALTER
-- EXTENSION, quindi va reinstallata nello schema extensions. Le sue funzioni
-- vivono comunque nello schema net (net.http_post, ...), perciò i job pg_cron
-- che le richiamano per testo (storage-gc) continuano a funzionare. Le tabelle
-- di coda/risposta sono UNLOGGED e volatili: perderle nella reinstallazione è
-- accettabile.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
