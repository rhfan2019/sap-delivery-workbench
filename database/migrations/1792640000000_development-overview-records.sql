-- Up Migration
-- docs/specs/development-overview.md section 6 (D1-D3), phase 2. Records written automatically
-- so the overview can measure work in progress, cycle times and the FSD handover; nobody types
-- anything new.

-- D1: one row per change of a phase status. The first row of every phase (from_status NULL) is
-- its status when the item was created. Append-only; derived from the item, so it goes with it.
CREATE TABLE app.development_phase_transition (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  item_id uuid NOT NULL,
  phase varchar(20) NOT NULL CHECK (phase IN ('fsd', 'development', 'consultant_test', 'user_test')),
  from_status varchar(20),
  to_status varchar(20) NOT NULL,
  actor_id uuid REFERENCES app.app_user(id),
  at timestamptz NOT NULL DEFAULT now(),
  -- Rebuilt from the change history by this migration rather than recorded when it happened.
  backfilled boolean NOT NULL DEFAULT false,
  FOREIGN KEY (organization_id, project_id, item_id)
    REFERENCES app.development_item(organization_id, project_id, id) ON DELETE CASCADE
);
CREATE INDEX development_phase_transition_item ON app.development_phase_transition(item_id, phase, at);
CREATE INDEX development_phase_transition_project ON app.development_phase_transition(organization_id, project_id, at);

-- D2: when a phase actually started; set automatically when it first goes in progress (or is
-- marked delayed), and editable by hand.
ALTER TABLE app.development_item_phase ADD COLUMN actual_start date;

-- D3: when and by whom a version was labelled 定稿. Earlier finals stay NULL (no reliable
-- source); the overview then falls back to the version's creation time, marked as estimated.
ALTER TABLE app.abap_fsd_agent_document ADD COLUMN finalized_at timestamptz,
  ADD COLUMN finalized_by uuid REFERENCES app.app_user(id);
ALTER TABLE app.abap_dev_agent_version ADD COLUMN finalized_at timestamptz,
  ADD COLUMN finalized_by uuid REFERENCES app.app_user(id);

-- Backfill D1: the status at creation (the "before" of the first recorded status change, else the
-- current status), then every recorded change.
INSERT INTO app.development_phase_transition
  (organization_id, project_id, item_id, phase, from_status, to_status, actor_id, at, backfilled)
SELECT p.organization_id, p.project_id, p.item_id, p.phase, NULL,
  COALESCE((
    SELECT e.changes -> (p.phase || '.status') ->> 'before' FROM app.development_event e
    WHERE e.item_id = p.item_id AND e.changes ? (p.phase || '.status')
      AND e.changes -> (p.phase || '.status') ->> 'before' IS NOT NULL
    ORDER BY e.created_at LIMIT 1
  ), p.status),
  i.created_by, i.created_at, true
FROM app.development_item_phase p JOIN app.development_item i ON i.id = p.item_id;

INSERT INTO app.development_phase_transition
  (organization_id, project_id, item_id, phase, from_status, to_status, actor_id, at, backfilled)
SELECT e.organization_id, e.project_id, e.item_id, k.phase,
  e.changes -> (k.phase || '.status') ->> 'before', e.changes -> (k.phase || '.status') ->> 'after',
  e.actor_id, e.created_at, true
FROM app.development_event e
CROSS JOIN unnest(ARRAY['fsd', 'development', 'consultant_test', 'user_test']) AS k(phase)
JOIN app.development_item i ON i.id = e.item_id
WHERE e.changes ? (k.phase || '.status')
  AND e.changes -> (k.phase || '.status') ->> 'after' IS NOT NULL
  AND (e.changes -> (k.phase || '.status') ->> 'before') IS DISTINCT FROM (e.changes -> (k.phase || '.status') ->> 'after');

-- Backfill D2: the first time a phase went in progress or delayed.
UPDATE app.development_item_phase p SET actual_start = s.started
FROM (
  SELECT item_id, phase, min(at)::date AS started FROM app.development_phase_transition
  WHERE to_status IN ('in_progress', 'delayed') GROUP BY item_id, phase
) s
WHERE s.item_id = p.item_id AND s.phase = p.phase AND p.actual_start IS NULL;

GRANT SELECT, INSERT ON app.development_phase_transition TO sap_workbench_app;
GRANT UPDATE (finalized_at, finalized_by) ON app.abap_fsd_agent_document TO sap_workbench_app;
GRANT UPDATE (finalized_at, finalized_by) ON app.abap_dev_agent_version TO sap_workbench_app;

-- Down Migration
ALTER TABLE app.abap_dev_agent_version DROP COLUMN finalized_by, DROP COLUMN finalized_at;
ALTER TABLE app.abap_fsd_agent_document DROP COLUMN finalized_by, DROP COLUMN finalized_at;
ALTER TABLE app.development_item_phase DROP COLUMN actual_start;
DROP TABLE app.development_phase_transition;
