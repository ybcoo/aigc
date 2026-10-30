ALTER TABLE "aigc_media_versions"
  ALTER COLUMN "shot_id" DROP NOT NULL,
  ADD COLUMN "asset_id" UUID,
  ADD COLUMN "reference_node_id" UUID,
  ADD COLUMN "audio_node_id" UUID,
  ADD COLUMN "aspect_ratio" TEXT NOT NULL DEFAULT '';

CREATE INDEX "aigc_media_versions_asset_id_kind_created_at_idx" ON "aigc_media_versions"("asset_id", "kind", "created_at");
CREATE INDEX "aigc_media_versions_reference_node_id_kind_created_at_idx" ON "aigc_media_versions"("reference_node_id", "kind", "created_at");
CREATE INDEX "aigc_media_versions_audio_node_id_kind_created_at_idx" ON "aigc_media_versions"("audio_node_id", "kind", "created_at");

ALTER TABLE "aigc_media_versions" ADD CONSTRAINT "aigc_media_versions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "aigc_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "aigc_media_versions" ADD CONSTRAINT "aigc_media_versions_reference_node_id_fkey" FOREIGN KEY ("reference_node_id") REFERENCES "aigc_canvas_reference_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "aigc_media_versions" ADD CONSTRAINT "aigc_media_versions_audio_node_id_fkey" FOREIGN KEY ("audio_node_id") REFERENCES "aigc_canvas_audio_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
