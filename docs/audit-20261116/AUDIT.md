# Audit comparatif des trois builders — 16 novembre 2026

**Verdict individuel : NO-GO pour les trois produits. Cette mission apporte des correctifs de sécurité et des tests locaux ; elle ne démontre pas la finalisation des trois moteurs. Zéro APK/AAB Android réel compilé ou vérifié pendant cette session.**

Périmètre : exclusivement `cortexAI-2025/apk-factory`, `aab-factory`, `Builder-AAB-APK`. Aucun changement ZEEROO, SimpleTools, MobixBuild, secret de production ou déploiement. Les workflows existants ne sont pas modifiés ; commits marqués `[skip ci]`, aucune exécution Actions demandée.

## Sources et méthode

Lecture du code local cloné, branches distantes, PR ouvertes, README, configurations, Dockerfiles, scripts, contrôleurs, workers, stockage et tests. Les affirmations marketing ne servent pas de preuve. L'inventaire complet des branches/commits consultés est dans `source-inventory.json` ; les tests exécutés dans `tests-*.txt`.

| Dépôt | Branche par défaut observée et SHA | Travail existant réutilisé |
|---|---|---|
| APK Factory | `claude/apk-factory-saas-ZByvQ`, `62186a33945d3d9fa45015790e22eafd37ad93d0` | PR #5 ouverte, `claude/v1-zip-to-debug-apk`, `df866383cd77a1734e3ef4444bab8329c14c54c8` ; correctifs empilés sur cette branche |
| AAB Factory | `claude/android-app-builder-saas-brggr`, `f017b31` (SHA complet dans inventaire) | Aucune PR ouverte observée ; correctifs sur la branche par défaut clonée |
| Builder double | `claude/android-build-automation-aL60M`, `922ae5f3359692a3a35f1b2f69b878c6a97c2364` | PR #1 ouverte, `feat/kotlin-dsl-support`, `b0039c2278f3492934608cfe8dac6d052bc48bc9` ; correctifs empilés |

Les PR empilées doivent être revues avec leur PR parente ; elles ne remplacent ni ne fusionnent ces travaux. Aucun `main` supposé : ces dépôts utilisent des branches par défaut portant d'autres noms.

## Conformité après corrections

`OK` signifie contrôle local démontré dans le périmètre indiqué, pas compilation Android homologuée. `PARTIEL` signifie code présent mais couverture ou preuve incomplète. `ABSENT` signifie fonctionnalité non implémentée. `BLOQUÉ` signifie validation impossible faute de prérequis.

| Exigence | APK Factory | AAB Factory | Builder AAB APK |
|---|---|---|---|
| Produits indépendants | OK | OK | OK |
| Format exclusif | OK : API, worker et téléversement refusent AAB | OK : service AAB uniquement | PARTIEL : deux sorties exigées, aucun E2E Android |
| Native Java/Kotlin, Groovy/KTS | PARTIEL : pipeline existant | PARTIEL : générateur Kotlin uniquement | PARTIEL : analyse Groovy/KTS et module personnalisé testée |
| Multimodules/flavors | PARTIEL : découverte APK existante | ABSENT pour import de projets | PARTIEL : analyse ; ambiguïtés/flavors à homologuer |
| Adaptation Gradle/AGP/JDK/SDK | PARTIEL : image JDK17/SDK limités | PARTIEL : modèle Gradle8.6/AGP8.3.2/SDK<=34 | PARTIEL : wrapper conservé, image JDK17 ; SDK requis sinon refus |
| React Native CLI | ABSENT : détecté puis rejeté | ABSENT | PARTIEL : préparation npm verrouillée ajoutée, image Node à provisionner, non compilé |
| Expo sans android | ABSENT | ABSENT | PARTIEL : prebuild local contrôlé ajouté, plugins non homologués |
| Expo avec android | ABSENT | ABSENT | PARTIEL : installation npm puis Gradle, non compilé |
| ZIP/GitHub | PARTIEL : ZIP et URL/tree GitHub existants | ABSENT pour import | PARTIEL : ZIP local ; interface GitHub séparée reste liée à Actions |
| Branche et commit immuable | PARTIEL : URL de branche, pas de sélecteur SHA complet | ABSENT | ABSENT dans console locale |
| Signature bloquante | PARTIEL : apksigner obligatoire avant upload, cas négatifs testés | PARTIEL : signature hors sandbox et jarsigner + bundletool, pas d'AAB signé réel | PARTIEL : vérification indépendante après sandbox, consentement par build, pas de signature réelle ici |
| Secrets hors du code non fiable | PARTIEL : allow-list héritée PR5 ; pas de service de clé release | PARTIEL : conteneur sans credentials ; clé uniquement dans signature séparée | PARTIEL : conteneur sans clé ; étape privée séparée |
| Limites CPU/RAM/PID/temps/disque | PARTIEL : arguments et watchdog testés, pas Docker réel | PARTIEL : Docker 2CPU/4Go/512PID/8min + surveillance disque | PARTIEL : Docker 2CPU/4Go/512PID/25min ; tmpfs2Go + surveillance sorties |
| Auth et téléchargements | PARTIEL : propriétaire JWT, héritage PR5 | PARTIEL : Firebase, liens Storage à durée limitée | PARTIEL : console loopback mono-propriétaire, pas de comptes multiples |
| Logs/diagnostic/historique | PARTIEL : backend/BullMQ/DB | PARTIEL : Firestore, pas de stream de logs Gradle | PARTIEL : SSE et historique mémoire, perdu au redémarrage |
| SHA-256 | PARTIEL : APK debug existant et calcul serveur ; release incomplet | PARTIEL : enregistré après vérification, UI à compléter | PARTIEL : manifest privé + affichage UI ; aucune empreinte d'artefact réel |
| Compilation et vérification réelles | BLOQUÉ | BLOQUÉ | BLOQUÉ |

## Anomalies et corrections

| ID | Priorité | Dépôt | Constat réel / traitement |
|---|---|---|---|
| S01 | P0 | Double | Signature invalide simple avertissement ; corrigé en refus de livraison, plus de repli jarsigner pour APK |
| S02 | P0 | AAB/double | Mots de passe en arguments ; remplacés par entrées d'environnement des outils, aucune erreur brute de signature exposée |
| S03 | P0 | AAB | Gradle exécuté sur l'API avec tout `process.env` ; remplacé par conteneur sans credentials, non-root, limites, signature après destruction du conteneur |
| S04 | P0 | Double | Gradle exécuté directement par serveur web ; lancement Docker restreint, aucun repli host, logs hors montage non fiable |
| S05 | P0 | Double | `unzip` non contrôlé ; validation préalable chemins, types, doublons, tailles, ratios ; refus symlinks/FIFO et anciens outputs |
| S06 | P0 | APK | Possibilité AAB via flag release ; refus API/worker/upload même si flag release activé |
| S07 | P0 | APK | Sorties jugées valides essentiellement par présence/taille ; apksigner requis avant tout upload, y compris debug |
| S08 | P0 | AAB | `keystoreType=user` ignoré et clé système utilisée ; demande rejetée avant consommation quota, aucun repli silencieux |
| S09 | P0 | AAB/double | Chemins de sortie contrôlés par projet ; sorties scellées hors workspace avant signature, refus liens ; double ne fait plus confiance au manifest du conteneur |
| S10 | P0 restant | Tous | Isolation Docker réelle, réseau, quotas et signature valide non homologués sur machine cible ; interdit un GO |
| S11 | P0 restant | APK | Next `14.2.3` déclenche un avertissement de vulnérabilité lors de `npm ci` ; mise à niveau ciblée et recette encore nécessaires |
| F01 | P1 | AAB | Activité compilée vide malgré sections IA sauvegardées ; rendu texte simple des sections visibles ajouté, pas de fonctionnalités e-commerce/formulaires inventées |
| F02 | P1 | AAB | Build TypeScript échoue sur imports/variable inutilisés ; corrigé, compilation TS et tests passent |
| F03 | P1 | Double | Custom module KTS rejeté et absence versionName provoque exit1 sous `set -e` ; corrigé et testé |
| F04 | P1 | Tous | RN/Expo incomplets ; seulement préparation contrôlée dans double, pas d'affirmation E2E |
| F05 | P1 | AAB | Imports ZIP/GitHub absents ; restent à implémenter dans les routes/interfaces existantes |
| F06 | P1 | Double | Interface Next GitHub dépend d'Actions ; console Express locale renforcée, migration du dashboard vers moteur local encore absente |
| F07 | P1 | AAB/double | File durable/reprise/interruption utilisateur manquantes ; une compilation à la fois, timeouts présents, crash recovery incomplet |
| F08 | P1 | Tous | Choix de SHA, provenance, JDK/Node par projet et matrice récente SDK36/37 non complets |
| F09 | P2 | Tous | Versions/dépendances anciennes, absence initiale lock AAB ; lock ajouté. Scan CVE externe bloqué, inventaire local fourni |
| F10 | P2 | Double | Historique durable, quota global de rétention, UI statuts indépendants en cas d'échec, diagnostics avancés à compléter |

### Sécurité et limites précises

Les limites de disque par surveillance sont des limites souples : un job peut dépasser momentanément le seuil entre deux contrôles. Une partition dédiée avec quota dur est requise pour un service public. Le montage Docker socket du worker est une capacité privilégiée : utiliser un hôte dédié, jamais le serveur des secrets/production. Les contrôles de source ne remplacent pas le confinement.

AAB Factory n'exécute qu'un job par processus API ; ce n'est pas une file durable partagée entre réplicas. Firebase/Stripe/IA restent présents et non modifiés fonctionnellement ; leur intégration n'a pas été testée avec des comptes réels. La génération IA produit des structures JSON, pas la preuve d'une application métier terminée.

La console locale double écoute uniquement `127.0.0.1` et refuse les origines différentes. Elle n'a pas d'authentification multi-utilisateur ; ne pas la publier directement. Une case décochée par défaut autorise explicitement la signature de l'AAB de ce build avec la clé locale configurée. La clé n'entre jamais dans le conteneur Gradle. Sans case, seules des sorties déjà correctement signées peuvent être livrées.

Le contrôle JAR accepte les certificats de développeur autosignés lorsqu'une signature cryptographique valide couvre les entrées ; il ne prétend pas vérifier l'appartenance d'une clé à un compte Google Play. `bundletool validate` vérifie la structure ; aucune mise en ligne Play n'est exécutée.

## Tests et artefacts

| Cas demandé | Résultat pendant cette session |
|---|---|
| 1. Android Kotlin | Analyse KTS/custom module et génération source testées ; compilation Android BLOQUÉE |
| 2. Android Java | Sélection Gradle/artefacts et analyse Groovy testées ; compilation Android BLOQUÉE |
| 3. React Native CLI | Préparation contrôlée double ajoutée ; E2E BLOQUÉ, absent des deux autres |
| 4. Expo managed | prebuild contrôlé double ajouté ; E2E BLOQUÉ |
| 5. Expo avec android | Branche de préparation double présente ; E2E BLOQUÉ |
| 6. Échec Gradle volontaire | Refus après processus en échec testé via Docker simulé HTTP ; vrai Gradle BLOQUÉ |
| 7. Keystore absent/invalide | Refus sans autorisation et absence de repli testés ; vraie clé invalide sur jarsigner BLOQUÉ |
| 8. ZIP malveillant | Refus chemins, liens, types spéciaux, doublons et bombe testés |
| 9. Build interrompu | Code de timeout/kill présent ; vraie interruption de conteneur BLOQUÉE |
| 10. Artefacts générés/vérifiés | Cas de refus et orchestration simulée testés ; **aucun APK/AAB réel** |

Résultats locaux : APK Factory **34 tests backend + 38 tests worker**, AAB Factory **4 tests backend**, Builder double **12 tests Python + 3 tests Node/HTTP**. Total : **91 tests réussis**. Vérification TypeScript des deux interfaces web exécutée avec `tsc --noEmit` : réussite. Syntaxe Bash et JavaScript modifiés : réussite. Ces contrôles ne remplacent pas une recette Docker/Android.

Les tests utilisant de faux outils ou de fausses sorties le disent explicitement. Un fichier `fixture`, un fichier ZIP ou un mock de signature n'est jamais comptabilisé comme APK/AAB compilé. Aucun hash d'artefact Android réel à publier. Les anciens dossiers d'évidence CI présents dans les branches ne constituent pas une preuve des nouveaux commits.

## Infrastructure et déploiement

Environnement de session observé : Linux x86_64, Node/npm, Python3.12, Java runtime21 ; environ 10Go RAM et 56Go disque libres. **Docker, SDK Android, apksigner, jarsigner et bundletool absents.** Pas de service Firebase/PostgreSQL/Redis de recette configuré. Le JRE21 n'est pas un JDK Android complet.

Dimensionnement de départ non benchmarké : un hôte de build dédié 4vCPU/8Go RAM, disque SSD avec au moins 30–60Go disponibles, un job 2CPU/3–4Go à la fois. Prévoir davantage pour RN/Expo et caches SDK/Node/Maven. Ne pas multiplier les jobs tant que le pic RAM et les temps n'ont pas été mesurés. Coût : machine + disque + stockage/rétention + trafic + Firebase/IA éventuels ; aucun tarif fournisseur inventé, aucune ressource payante créée.

### APK Factory

1. Revoir PR5 puis cette PR empilée ; conserver la distinction APK exclusivement.
2. Provisionner Docker, PostgreSQL, Redis, proxy egress restreint de la branche PR5, espace de travail host visible au même chemin.
3. Reconstruire image worker : apksigner et JRE ajoutés, `APKSIGNER_PATH=/usr/bin/apksigner`.
4. Construire image Android avec toolchains réellement requises. Le flag release n'autorise pas AAB et n'apporte pas un service de keystore.
5. Migrer Prisma suivant les fichiers de la branche PR5, démarrer via Compose sur hôte de recette ; aucun déploiement exécuté ici.
6. Exécuter référence Java/Kotlin, puis apksigner et installation Galaxy A14 ; RN/Expo restent non supportés à ce stade.

### AAB Factory

1. `cd backend && npm ci --ignore-scripts && npm test` ; config Firebase de recette, pas de clés production.
2. Provisionner image référencée par `AAB_BUILDER_IMAGE`, JDK17/SDK34 et caches Gradle8.6/Maven nécessaires au modèle. Le sandbox est hors réseau ; un cache incomplet doit échouer, pas ouvrir le réseau automatiquement.
3. Fournir un **vrai** `gradle-wrapper.jar` via `GRADLE_WRAPPER_JAR_PATH` ; le jar launcher n'est pas le wrapper. Le serveur et le daemon Docker doivent voir `AAB_WORKSPACE_DIR` au même chemin.
4. Sur l'hôte de signature : JDK avec jarsigner, bundletool revu via `BUNDLETOOL_JAR`, clé propriétaire configurée hors workspace, permissions privées. Activer `SIGNING_AUTHORIZED=true` uniquement pour une clé explicitement autorisée.
5. `keystoreType=user` reste rejeté jusqu'à un vrai stockage/import de clés par propriétaire. Imports source/RN/Expo, file durable et UI SHA restent à développer.

### Builder AAB APK

1. Revoir PR1 puis cette PR empilée. `python3 -m unittest discover -s tests -v` ; `cd web && npm ci --ignore-scripts` ; `node --test *.test.cjs`.
2. Fournir un bundletool jar revu dans `vendor/bundletool.jar`, puis `docker build -t android-builder:local .` ; image non construite ici. Provisionner images JDK/SDK/Node adaptées ; l'image fournie n'installe pas encore Node, donc RN/Expo échouent explicitement sans image adaptée.
3. `node web/server.js` ; console locale port3000, uniquement loopback. Les chemins d'uploads/sorties doivent être visibles à l'identique par le daemon Docker. UID1000 pour jobs, hôte lancé en UID1000 ou root pour préparation des permissions ; le conteneur Gradle reste UID1000.
4. Hôte de finalisation : Python, apksigner, JDK/jarsigner, bundletool via `BUNDLETOOL_JAR`. Configurer une clé locale si désiré ; cocher l'autorisation à chaque build. Sans clé/autorisation, un AAB unsigned est refusé.
5. Les scripts de build direct sur l'hôte sont désactivés ; `build.sh` requiert le sandbox. Le mode interne `STAGE_UNSIGNED_RELEASE` produit seulement un état privé `STAGED`, jamais une livraison.
6. Tester sur sources SHA figé. Le pipeline prépare une seule copie source puis lance `assembleDebug` et `bundleRelease` ; pas de second clone ni prebuild entre les deux.

L'APK debug de recette est installable directement et signé avec la clé debug du projet. Google Play génère des APK optimisés pour l'appareil à partir de l'AAB et peut les signer avec une autre clé via Play App Signing. Taille, découpes ABI/densité et signature peuvent donc différer ; un APK debug ne prouve pas une mise à jour compatible avec l'application Play. Tester aussi l'AAB avec bundletool/device quand l'environnement existe.

## Décisions/prérequis du propriétaire

- Mettre à disposition un hôte de recette Docker avec SDK/JDK complets et un stockage sous quota ; aucun GO sans artefacts vérifiés sur cet hôte.
- Choisir les versions Android/RN/Expo effectivement annoncées et fournir un projet de référence par catégorie, à SHA figé.
- Choisir le mode de signature par propriétaire et distinguer clé d'upload Play/clé de distribution/debug ; ne jamais fournir de secret dans une PR ou un journal.
- Décider du maintien de la console locale mono-propriétaire ou d'une exposition distante authentifiée, et du raccordement du dashboard GitHub existant au moteur local.
- Autoriser ou non un scan externe d'avis de vulnérabilités : `npm audit` a été rejeté par la revue automatique car il transmet des métadonnées de dépendances au registre public. L'inventaire local est disponible ; ce refus n'a pas été contourné.

**La finalisation Android/RN/Expo reste ouverte. Ces branches sont des corrections préparées pour revue, pas des produits homologués ni des déploiements.**
