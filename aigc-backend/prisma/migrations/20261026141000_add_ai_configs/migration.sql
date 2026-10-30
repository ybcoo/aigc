CREATE TABLE "aigc_ai_configs" (
    "id" UUID NOT NULL,
    "service_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT '',
    "api_protocol" TEXT NOT NULL DEFAULT 'openai',
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "api_key" TEXT NOT NULL DEFAULT '',
    "models" JSONB NOT NULL DEFAULT '[]',
    "default_model" TEXT NOT NULL DEFAULT '',
    "endpoint" TEXT NOT NULL DEFAULT '',
    "query_endpoint" TEXT NOT NULL DEFAULT '',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "runtime_params" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aigc_ai_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "aigc_ai_configs_service_type_is_active_is_default_priority_idx"
ON "aigc_ai_configs"("service_type", "is_active", "is_default", "priority");
