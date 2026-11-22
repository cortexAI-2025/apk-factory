# Utiliser APK Factory

APK Factory reçoit un projet Android, reconnaît le framework, compile dans un conteneur, signe si le projet n’a pas déjà sa propre clé, puis sert l’APK ou l’AAB sur l’API.

Frameworks : Java, Kotlin, Flutter, React Native, Expo, Capacitor, Cordova.

Ce n’est pas un déploiement. La pull request n’est pas fusionnée. La clé locale de signature n’est pas remplacée par la CI : le runner crée la sienne et ne la publie pas.

## Lancer la pile

Prérequis : Docker, un fichier `.env` (voir `.env.example`) avec `POSTGRES_PASSWORD` et `REDIS_PASSWORD`.

```bash
docker compose build
docker compose up -d
```

L’API écoute sur `http://127.0.0.1:4000` (`/api/v1`). L’interface est sur `http://127.0.0.1:3000`.

Compte : `POST /api/v1/auth/register` avec `email`, `name`, `password`. Les routes suivantes envoient `Authorization: Bearer <token>`.

## Envoyer un projet et compiler

1. `POST /api/v1/projects/upload` en `multipart` : champ `file` (ZIP à la racine du projet) et champ `name`.
2. `POST /api/v1/projects/<id>/builds` avec `{ "buildType": "DEBUG" }`, `"RELEASE"` ou `"AAB"`.
3. `GET /api/v1/projects/<id>/builds/<buildId>` jusqu’à `SUCCESS` ou `FAILED`.
4. `GET /api/v1/projects/<id>/builds/<buildId>/artifacts/<artifactId>/download`.

Le téléchargement propriétaire envoie l’en-tête `X-Artifact-SHA256`. Il doit être égal au SHA-256 du fichier reçu et au `sha256` stocké.

Un second compte reçoit 404 sur ce téléchargement. Un ZIP qui n’en est pas un est refusé (400).

## Ce que la signature veut dire

- APK **debug** : clé Android Debug (`CN=Android Debug`). Ce n’est pas une signature de production.
- APK **release** ou **AAB** non signé par le projet : clé de l’usine (`CN=APK Factory`). Elle vit dans `APK_FACTORY_KEY_DIR` et n’entre pas dans le conteneur de build.
- Projet déjà signé : la clé du projet est conservée. L’usine ne la remplace pas.

## Limites d’un build

Chaque compilation est un conteneur séparé : utilisateur 1000, racine en lecture seule, `--cap-drop ALL`, réseau limité au proxy de la liste d’hôtes, CPU, RAM, tmpfs, délai et quota disque. Les valeurs par défaut sont dans `worker/src/security/sandbox-config.ts`. La CI publique les fixe à 2 CPU, 8 Go de RAM, tmpfs 4 Go, 40 minutes, 6 Go de workspace.

## Preuve sur GitHub Actions

Le dépôt public compile l’image `docker/android-builder/Dockerfile` sur `ubuntu-24.04` (Docker réel, PostgreSQL 16, Redis 7). Le job `frameworks` envoie un projet minimal par framework et télécharge l’artefact. Les fichiers et `frameworks-report.json` sont les artefacts du run. Un échec de ce job est un échec réel, pas une simulation.

Les émulateurs du job `e2e` sont la seule preuve d’installation. Pas d’appareil, pas d’installation certifiée.
