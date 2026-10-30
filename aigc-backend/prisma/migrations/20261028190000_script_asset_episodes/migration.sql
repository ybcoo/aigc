CREATE TABLE "aigc_asset_episodes" (
    "asset_id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    CONSTRAINT "aigc_asset_episodes_pkey" PRIMARY KEY ("asset_id", "episode_id"),
    CONSTRAINT "aigc_asset_episodes_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "aigc_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "aigc_asset_episodes_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "aigc_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "aigc_asset_episodes_episode_id_idx" ON "aigc_asset_episodes"("episode_id");
INSERT INTO "aigc_asset_episodes" ("asset_id", "episode_id")
SELECT a."id", e."id" FROM "aigc_assets" a
JOIN "aigc_episodes" e ON e."project_id" = a."project_id" AND e."episode_number" = a."episode_number"
ON CONFLICT DO NOTHING;
