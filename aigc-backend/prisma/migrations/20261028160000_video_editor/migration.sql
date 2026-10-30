ALTER TABLE "aigc_episodes" ADD COLUMN "timeline" JSONB, ADD COLUMN "timeline_revision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "aigc_editor_media" (
  "id" UUID NOT NULL, "project_id" UUID NOT NULL, "episode_number" INTEGER NOT NULL DEFAULT 1,
  "source_key" TEXT NOT NULL, "name" TEXT NOT NULL, "kind" TEXT NOT NULL, "url" TEXT NOT NULL,
  "duration" INTEGER NOT NULL, "width" INTEGER NOT NULL DEFAULT 0, "height" INTEGER NOT NULL DEFAULT 0,
  "has_audio" BOOLEAN NOT NULL DEFAULT false, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aigc_editor_media_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aigc_editor_media_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "aigc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "aigc_editor_media_project_id_episode_number_source_key_key" ON "aigc_editor_media"("project_id", "episode_number", "source_key");
