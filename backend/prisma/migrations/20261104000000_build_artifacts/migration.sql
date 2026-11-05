-- CreateTable
CREATE TABLE "build_artifacts" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'debug',
    "abi" TEXT NOT NULL DEFAULT 'universal',
    "module" TEXT NOT NULL DEFAULT '',
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "buildId" TEXT NOT NULL,

    CONSTRAINT "build_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "build_artifacts_buildId_idx" ON "build_artifacts"("buildId");

-- AddForeignKey
ALTER TABLE "build_artifacts" ADD CONSTRAINT "build_artifacts_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

