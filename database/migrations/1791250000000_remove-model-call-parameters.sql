-- Up Migration
UPDATE app.llm_model_version
SET config = config - ARRAY['maxOutputTokens','timeoutSeconds','temperature']::text[]
WHERE config ?| ARRAY['maxOutputTokens','timeoutSeconds','temperature'];
ALTER TABLE app.llm_model_version ADD CONSTRAINT llm_model_connection_only
CHECK (NOT (config ?| ARRAY['maxOutputTokens','timeoutSeconds','temperature']));
-- Down Migration
ALTER TABLE app.llm_model_version DROP CONSTRAINT llm_model_connection_only;
-- Removed values intentionally are not restored.
