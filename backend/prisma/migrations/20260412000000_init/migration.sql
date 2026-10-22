-- CreateEnum
CREATE TYPE "UserPlan" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "ProjectSourceType" AS ENUM ('ZIP_UPLOAD', 'GITHUB_URL', 'GITHUB_OAUTH', 'AI_GENERATED');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('ANDROID_NATIVE', 'FLUTTER', 'REACT_NATIVE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "BuildStatus" AS ENUM ('PENDING', 'QUEUED', 'BUILDING', 'FIXING', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "BuildType" AS ENUM ('DEBUG', 'RELEASE', 'AAB');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT,
    "avatarUrl" TEXT,
    "githubId" TEXT,
    "githubToken" TEXT,
    "plan" "UserPlan" NOT NULL DEFAULT 'FREE',
    "buildsUsed" INTEGER NOT NULL DEFAULT 0,
    "buildsLimit" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" "ProjectSourceType" NOT NULL,
    "sourceUrl" TEXT,
    "sourcePath" TEXT,
    "projectType" "ProjectType" NOT NULL DEFAULT 'UNKNOWN',
    "gradleVersion" TEXT,
    "sdkVersion" INTEGER,
    "kotlinVersion" TEXT,
    "javaVersion" TEXT,
    "compatibilityScore" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "builds" (
    "id" TEXT NOT NULL,
    "status" "BuildStatus" NOT NULL DEFAULT 'PENDING',
    "buildType" "BuildType" NOT NULL DEFAULT 'DEBUG',
    "queueJobId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "apkPath" TEXT,
    "apkSize" INTEGER,
    "apkUrl" TEXT,
    "publicLink" TEXT,
    "publicLinkExpiry" TIMESTAMP(3),
    "qrCodeUrl" TEXT,
    "errorMessage" TEXT,
    "autoFixAttempts" INTEGER NOT NULL DEFAULT 0,
    "maxFixAttempts" INTEGER NOT NULL DEFAULT 3,
    "dockerContainer" TEXT,
    "gradleCommand" TEXT,
    "runtime" TEXT,
    "mavenCacheHit" BOOLEAN NOT NULL DEFAULT false,
    "cpuSeconds" DOUBLE PRECISION,
    "costCredits" DOUBLE PRECISION,
    "environment" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "builds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "build_logs" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "buildId" TEXT NOT NULL,

    CONSTRAINT "build_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "build_fixes" (
    "id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "errorSummary" TEXT NOT NULL,
    "fixDescription" TEXT NOT NULL,
    "filesModified" JSONB NOT NULL,
    "patches" JSONB,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "buildId" TEXT NOT NULL,

    CONSTRAINT "build_fixes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_githubId_key" ON "users"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builds" ADD CONSTRAINT "builds_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_logs" ADD CONSTRAINT "build_logs_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_fixes" ADD CONSTRAINT "build_fixes_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

