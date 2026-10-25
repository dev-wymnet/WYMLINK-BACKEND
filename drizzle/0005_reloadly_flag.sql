-- Add telecom_reloadly_enabled flag to users table if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users'
          AND column_name = 'telecom_reloadly_enabled'
    ) THEN
        ALTER TABLE users
        ADD COLUMN telecom_reloadly_enabled boolean NOT NULL DEFAULT false;
    END IF;
END$$;
