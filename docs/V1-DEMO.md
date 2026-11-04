# APK Factory V1 — démo ZIP → APK debug

Périmètre V1 : un projet Android Gradle (avec wrapper) importé en ZIP est compilé avec
`assembleDebug` dans un conteneur jetable, puis l'APK debug (signé avec la clé debug
Android) est téléchargeable par son propriétaire uniquement. Release et AAB sont hors
périmètre (désactivés tant que `ENABLE_RELEASE_BUILDS` n'est pas `true`).

## Rejouer la démo en local

Prérequis : Docker, Node 20.

```bash
cp .env.example .env            # renseigner POSTGRES_PASSWORD, REDIS_PASSWORD, JWT_SECRET, WORKER_SECRET
mkdir -p /tmp/apk-factory/workspaces && chmod 1777 /tmp/apk-factory/workspaces
docker compose --profile init build android-builder-init   # image SDK 34 / JDK 17 (≈ 3-5 min)
docker compose up -d --build
docker compose run --rm backend npx prisma migrate deploy
```

1. Ouvrir <http://localhost:3000>, créer un compte.
2. **New Project → Upload ZIP** : choisir `examples/reference-android.zip`
   (ou `reference-android-nested.zip`, projet dans un dossier parent).
3. Ouvrir le projet → **Build APK** (Debug APK). Suivre l'état Queued → Building → Successful.
4. Dans la carte *Debug APK* : nom, taille, **SHA-256**, bouton **Download**.
5. Vérifier : `sha256sum app-debug.apk` doit égaler le SHA-256 affiché ;
   `apksigner verify --print-certs app-debug.apk` → `CN=Android Debug`.
6. Installer sur le téléphone (autoriser « Installer des applications inconnues »).
   L'écran attendu : fond vert, **« APK Factory Reference OK »**.

Les ZIP de référence se régénèrent avec `bash scripts/make-reference-zip.sh`.

## Contrôles automatisés (CI)

Le workflow `.github/workflows/ci.yml` exécute, sur chaque push :

| Étape | Ce qui est prouvé |
|---|---|
| Typecheck + tests unitaires | backend (validation ZIP), worker (scanner, artefacts, redaction, diagnostic), frontend |
| `scripts/isolation-check.mjs` | conteneur de build : uid 1000, 0 capability, no-new-privileges, rootfs en lecture seule, pas de socket Docker, aucun secret, workspace d'un autre job invisible, limites mémoire/PIDs/fichiers, pas d'accès Internet direct, proxy à liste blanche (metadata/loopback/hôtes non listés refusés) |
| `e2e/ui-flow.cjs` | parcours complet dans l'interface web, SHA-256 affiché = SHA-256 du fichier téléchargé |
| `e2e/verify-apk.sh` | `apksigner verify` (certificat debug), package `com.apkfactory.reference` |
| `e2e/api-checks.cjs` | ZIP invalides rejetés (texte, sans wrapper, traversée de chemin, lien symbolique, bombe de compression, hors Android), échec de compilation → diagnostic exploitable et logs expurgés, 2ᵉ compte refusé (404), anonyme refusé (401), aucun accès statique aux sources/artefacts |
| `e2e/emulator-check.sh` | installation sur émulateur Android 34, démarrage, écran attendu, pas de crash |

Les preuves (APK, captures, journaux) sont publiées dans l'artefact `e2e-evidence` du run
et dans la branche `ci-evidence` (`runs/<sha>-<run>/`).

## Réglages de sécurité (variables d'environnement)

| Variable | Défaut | Rôle |
|---|---|---|
| `BUILD_NETWORK_MODE` | `restricted` | `restricted` (proxy à liste blanche), `none`, `bridge` (dev uniquement) |
| `docker/egress-proxy/allowed-domains.txt` | Google Maven, Maven Central, Gradle, JitPack, GitHub | hôtes joignables pendant un build |
| `BUILD_MEMORY` / `BUILD_CPUS` / `BUILD_TIMEOUT_MS` | `4g` / `2` / 25 min | limites par build |
| `BUILD_MAX_WORKSPACE_MB` | `4096` | quota disque (surveillé, le conteneur est tué au-delà) |
| `ZIP_MAX_UPLOAD_MB` / `ZIP_MAX_EXTRACTED_MB` / `ZIP_MAX_FILE_MB` | `200` / `1024` / `256` | limites d'import |
| `RETENTION_HOURS` | `24` | purge des sources et artefacts |
| `ENABLE_RELEASE_BUILDS` | `false` | hors périmètre V1 |

## Limites connues (à lever avant d'ouvrir à des tiers)

- Le worker pilote Docker via le socket de l'hôte : un compromis du worker équivaut à un accès
  root à l'hôte. À isoler sur une VM dédiée ou à remplacer par Docker rootless / Sysbox / gVisor.
- Les conteneurs de build partagent le noyau de l'hôte (runc). Pour des projets non fiables,
  activer gVisor (`RUNTIME=gvisor`, non testé en CI).
- Le téléchargement de la distribution Gradle et des dépendances se fait à chaque build
  (≈ 35 s pour le projet de référence) ; pas de cache persistant.
- Le `gradle-wrapper.jar` des projets importés n'est pas vérifié contre les sommes de contrôle
  officielles de Gradle (il s'exécute uniquement dans le sandbox).
- La correction automatique par IA est activée par défaut ; elle n'envoie rien tant que
  `ANTHROPIC_API_KEY` n'est pas défini.
- Le lien de partage public est une action explicite du propriétaire (valide 7 jours).
- Flutter et React Native ne sont pas pris en charge.
