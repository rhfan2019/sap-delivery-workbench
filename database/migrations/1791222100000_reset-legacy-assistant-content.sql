-- Up Migration
-- Narrow reset procedure: ordinary runtime SQL retains append-only history grants.
CREATE FUNCTION app.reset_legacy_assistant_content(p_org uuid,p_project uuid,p_item uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE w uuid;
BEGIN
  FOR w IN SELECT id FROM app.fs_workspace WHERE organization_id=p_org AND project_id=p_project AND item_id=p_item FOR UPDATE LOOP
    UPDATE app.fs_workspace SET draft_head=NULL,review_head=NULL,baseline_head=NULL,assistant_reset_at=now(),row_version=row_version+1 WHERE id=w;
    UPDATE app.fs_entity SET head_revision=NULL WHERE workspace_id=w;
    DELETE FROM app.fs_publication WHERE workspace_id=w;
    DELETE FROM app.fs_export WHERE workspace_id=w;
    DELETE FROM app.fs_approval WHERE workspace_id=w;
    DELETE FROM app.fs_review_request WHERE workspace_id=w;
    DELETE FROM app.fs_review WHERE workspace_id=w;
    DELETE FROM app.fs_change_set WHERE workspace_id=w;
    DELETE FROM app.fs_confirmation WHERE workspace_id=w;
    DELETE FROM app.fs_dependency WHERE workspace_id=w;
    DELETE FROM app.fs_entity_revision WHERE workspace_id=w;
    DELETE FROM app.fs_entity WHERE workspace_id=w;
    DELETE FROM app.fs_evidence WHERE workspace_id=w;
    DELETE FROM app.fs_parse_result WHERE workspace_id=w;
    DELETE FROM app.fs_attachment WHERE workspace_id=w;
    DELETE FROM app.fs_document_revision WHERE workspace_id=w;
    DELETE FROM app.fs_run_event WHERE workspace_id=w;
    DELETE FROM app.fs_run_checkpoint WHERE workspace_id=w;
    DELETE FROM app.fs_run WHERE workspace_id=w;
    DELETE FROM app.fs_message WHERE workspace_id=w;
    DELETE FROM app.fs_session WHERE workspace_id=w;
    DELETE FROM app.fs_context_snapshot WHERE workspace_id=w;
    DELETE FROM app.fs_command_receipt WHERE workspace_id=w;
  END LOOP;
  UPDATE app.fs_draft SET sections='{}',submitted_version_id=NULL,row_version=row_version+1,updated_at=now() WHERE organization_id=p_org AND project_id=p_project AND item_id=p_item;
  DELETE FROM app.fs_version WHERE organization_id=p_org AND project_id=p_project AND item_id=p_item;
END $$;
REVOKE ALL ON FUNCTION app.reset_legacy_assistant_content(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reset_legacy_assistant_content(uuid,uuid,uuid) TO sap_workbench_app;
-- Down Migration
DROP FUNCTION app.reset_legacy_assistant_content(uuid,uuid,uuid);
