-- Up Migration
-- docs/specs/development-load.md: the order of people in the development load table. Kept on
-- the project membership (maintained in 项目 → 成员与权限); empty sorts last, by name.
ALTER TABLE app.project_member
  ADD COLUMN sort_code integer CHECK (sort_code BETWEEN 0 AND 9999);

-- Down Migration
ALTER TABLE app.project_member DROP COLUMN sort_code;
