-- Up Migration
-- Reconstructed 2026-10-11: the original file was already applied to the dev and test
-- databases but never committed, and was deleted with the abandoned insights work.
-- Index definitions are copied from pg_indexes of the dev database.
CREATE INDEX fsd_v1_attempt_run ON app.fsd_v1_attempt USING btree (run_id, started_at);
CREATE INDEX fsd_v1_attempt_trace ON app.fsd_v1_attempt USING btree (trace_id) WHERE (trace_id IS NOT NULL);
CREATE INDEX fsd_v1_chat_turn_run ON app.fsd_v1_chat_turn USING btree (run_id, created_at);
CREATE INDEX fsd_v1_event_run ON app.fsd_v1_event USING btree (run_id, created_at);
CREATE INDEX fsd_v1_operation_run ON app.fsd_v1_operation USING btree (run_id, created_at);
CREATE INDEX fsd_v1_run_created ON app.fsd_v1_run USING btree (created_at);
CREATE INDEX fsd_v1_run_task ON app.fsd_v1_run USING btree (task_id, created_at);
-- Down Migration
DROP INDEX app.fsd_v1_attempt_run, app.fsd_v1_attempt_trace, app.fsd_v1_chat_turn_run, app.fsd_v1_event_run, app.fsd_v1_operation_run, app.fsd_v1_run_created, app.fsd_v1_run_task;
