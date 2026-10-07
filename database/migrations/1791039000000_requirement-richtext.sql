-- Up Migration
ALTER TABLE app.development_item ADD COLUMN summary_format varchar(10) NOT NULL DEFAULT 'plain'
 CHECK(summary_format IN ('plain','html'));
ALTER TABLE app.development_item ALTER COLUMN priority SET DEFAULT 'low';

-- Down Migration
-- Keep the format discriminator: removing it would make stored rich text ambiguous.
ALTER TABLE app.development_item ALTER COLUMN priority SET DEFAULT 'medium';
