-- Site-wide branding/settings singleton (id = 1): dynamic brand name + logo.
CREATE TABLE IF NOT EXISTS "site_settings" (
  "id"         INTEGER      NOT NULL DEFAULT 1,
  "brand_name" VARCHAR(150) NOT NULL DEFAULT 'Kommon School',
  "logo_url"   VARCHAR(500),
  "created_at" TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

-- Seed the single row so reads always find branding.
INSERT INTO "site_settings" ("id", "brand_name")
VALUES (1, 'Kommon School')
ON CONFLICT ("id") DO NOTHING;
