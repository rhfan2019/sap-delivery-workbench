-- Up Migration
-- docs/specs/development-overview.md section 6 (D5), phase 3: the first planned end of each
-- phase is its baseline, so plan drift (M09) is measured against what was first promised.
-- Set automatically the first time a planned end is filled in; nobody edits it.
ALTER TABLE app.development_item_phase ADD COLUMN baseline_end date;

-- Backfill: the earliest planned end the change history knows (the "before" of the first change,
-- or its "after" when it was empty before), else the current planned end.
UPDATE app.development_item_phase p SET baseline_end = COALESCE((
  SELECT COALESCE(e.changes -> (p.phase || '.plannedEnd') ->> 'before',
                  e.changes -> (p.phase || '.plannedEnd') ->> 'after')::date
  FROM app.development_event e
  WHERE e.item_id = p.item_id AND e.changes ? (p.phase || '.plannedEnd')
    AND COALESCE(e.changes -> (p.phase || '.plannedEnd') ->> 'before',
                 e.changes -> (p.phase || '.plannedEnd') ->> 'after') IS NOT NULL
  ORDER BY e.created_at LIMIT 1
), p.planned_end);

-- Down Migration
ALTER TABLE app.development_item_phase DROP COLUMN baseline_end;
