-- CreateTable
CREATE TABLE "aigc_projects" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "genre" TEXT NOT NULL DEFAULT '',
    "style" TEXT NOT NULL DEFAULT '',
    "aspect_ratio" TEXT NOT NULL DEFAULT '16:9',
    "story_summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "episode_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aigc_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aigc_episodes" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "episode_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "script_content" TEXT NOT NULL DEFAULT '',
    "storyboard_notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aigc_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aigc_assets" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "episode_number" INTEGER NOT NULL DEFAULT 1,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "appearance" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL DEFAULT '',
    "image_url" TEXT NOT NULL DEFAULT '',
    "voice_url" TEXT NOT NULL DEFAULT '',
    "aspect_ratio" TEXT NOT NULL DEFAULT '1:1',
    "related_asset_ids" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aigc_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aigc_canvas_text_nodes" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "episode_number" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL DEFAULT '新建文本',
    "content" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aigc_canvas_text_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aigc_canvas_reference_nodes" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "episode_number" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL DEFAULT '参考图',
    "image_url" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL DEFAULT '',
    "aspect_ratio" TEXT NOT NULL DEFAULT '1:1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aigc_canvas_reference_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aigc_canvas_audio_nodes" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "episode_number" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL DEFAULT '参考音色',
    "audio_url" TEXT NOT NULL DEFAULT '',
    "duration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aigc_canvas_audio_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aigc_shots" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "episode_number" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "source_script" TEXT NOT NULL DEFAULT '',
    "storyboard_script" TEXT NOT NULL DEFAULT '',
    "universal_prompt" TEXT NOT NULL DEFAULT '',
    "dialogue" TEXT NOT NULL DEFAULT '',
    "shot_type" TEXT NOT NULL DEFAULT '中景',
    "movement" TEXT NOT NULL DEFAULT '固定机位',
    "aspect_ratio" TEXT NOT NULL DEFAULT '16:9',
    "duration" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "video_resolution" TEXT NOT NULL DEFAULT '480p',
    "image_url" TEXT NOT NULL DEFAULT '',
    "last_image_url" TEXT NOT NULL DEFAULT '',
    "video_url" TEXT NOT NULL DEFAULT '',
    "asset_ids" JSONB NOT NULL DEFAULT '[]',
    "reference_video_ids" JSONB NOT NULL DEFAULT '[]',
    "reference_audio_ids" JSONB NOT NULL DEFAULT '[]',
    "canvas_video_node" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aigc_shots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aigc_canvas_links" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "episode_number" INTEGER NOT NULL DEFAULT 1,
    "source_kind" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aigc_canvas_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aigc_canvas_layouts" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "episode_number" INTEGER NOT NULL DEFAULT 1,
    "node_id" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aigc_canvas_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aigc_media_versions" (
    "id" UUID NOT NULL,
    "shot_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'generated',
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aigc_media_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aigc_jobs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "episode_number" INTEGER NOT NULL DEFAULT 1,
    "kind" TEXT NOT NULL,
    "target_id" TEXT NOT NULL DEFAULT '',
    "model_id" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL DEFAULT '{}',
    "references" JSONB NOT NULL DEFAULT '[]',
    "result" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT NOT NULL DEFAULT '',
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aigc_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "aigc_episodes_project_id_episode_number_key" ON "aigc_episodes"("project_id", "episode_number");

-- CreateIndex
CREATE INDEX "aigc_assets_project_id_episode_number_kind_idx" ON "aigc_assets"("project_id", "episode_number", "kind");

-- CreateIndex
CREATE INDEX "aigc_canvas_text_nodes_project_id_episode_number_idx" ON "aigc_canvas_text_nodes"("project_id", "episode_number");

-- CreateIndex
CREATE INDEX "aigc_canvas_reference_nodes_project_id_episode_number_idx" ON "aigc_canvas_reference_nodes"("project_id", "episode_number");

-- CreateIndex
CREATE INDEX "aigc_canvas_audio_nodes_project_id_episode_number_idx" ON "aigc_canvas_audio_nodes"("project_id", "episode_number");

-- CreateIndex
CREATE INDEX "aigc_shots_project_id_episode_number_position_idx" ON "aigc_shots"("project_id", "episode_number", "position");

-- CreateIndex
CREATE INDEX "aigc_canvas_links_project_id_episode_number_idx" ON "aigc_canvas_links"("project_id", "episode_number");

-- CreateIndex
CREATE UNIQUE INDEX "aigc_canvas_links_project_id_episode_number_source_kind_sou_key" ON "aigc_canvas_links"("project_id", "episode_number", "source_kind", "source_id", "target_kind", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "aigc_canvas_layouts_project_id_episode_number_node_id_key" ON "aigc_canvas_layouts"("project_id", "episode_number", "node_id");

-- CreateIndex
CREATE INDEX "aigc_media_versions_shot_id_kind_created_at_idx" ON "aigc_media_versions"("shot_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "aigc_jobs_project_id_episode_number_status_idx" ON "aigc_jobs"("project_id", "episode_number", "status");

-- AddForeignKey
ALTER TABLE "aigc_episodes" ADD CONSTRAINT "aigc_episodes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "aigc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aigc_assets" ADD CONSTRAINT "aigc_assets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "aigc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aigc_canvas_text_nodes" ADD CONSTRAINT "aigc_canvas_text_nodes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "aigc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aigc_canvas_reference_nodes" ADD CONSTRAINT "aigc_canvas_reference_nodes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "aigc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aigc_canvas_audio_nodes" ADD CONSTRAINT "aigc_canvas_audio_nodes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "aigc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aigc_shots" ADD CONSTRAINT "aigc_shots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "aigc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aigc_canvas_links" ADD CONSTRAINT "aigc_canvas_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "aigc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aigc_canvas_layouts" ADD CONSTRAINT "aigc_canvas_layouts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "aigc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aigc_media_versions" ADD CONSTRAINT "aigc_media_versions_shot_id_fkey" FOREIGN KEY ("shot_id") REFERENCES "aigc_shots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aigc_jobs" ADD CONSTRAINT "aigc_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "aigc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
