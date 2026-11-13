# Déploiement privé d'APK Factory sur une VM (Hetzner + Docker Compose + Tailscale)

Statut : **préparation locale**. Aucune VM n'est créée, rien n'est poussé, aucun déploiement n'est lancé.
Périmètre : un seul utilisateur (le propriétaire) et ses invités, accédant depuis un Samsung Galaxy A14.

---

## 1. Budget (tarifs Hetzner consultés le 13/11/2026, HT, hors TVA)

| Poste | Référence | Prix mensuel |
|---|---|---|
| Serveur | **CPX32** : 4 vCPU AMD partagés, 8 Go RAM, 160 Go NVMe, 20 To de trafic inclus (UE), site **HEL1** (Finlande) | **30,49 €** (NBG1 / FSN1 : 35,99 €) |
| Sauvegardes du serveur (optionnel) | Add-on Hetzner, 20 % du prix du serveur (à vérifier au moment de la commande) | ≈ 6,10 € |
| Sauvegardes hors VM (**recommandé**) | **Storage Box BX11**, 1 To, SSH/rsync, sans frais d'installation | **3,20 €** |
| Trafic supplémentaire | 1 € par To au-delà de 20 To | 0 € en pratique |
| Accès privé | Tailscale (plan personnel) | 0 € (limites du plan à vérifier) |
| Nom de domaine | Non nécessaire : nom MagicDNS Tailscale + certificat Tailscale | 0 € |

**Total recommandé : ≈ 33,69 € HT/mois** (serveur + Storage Box), **≈ 39,79 € HT** avec l'add-on de sauvegarde serveur.
Soit environ **40 € HT, 48 € TTC** (TVA française 20 %) avec les deux sauvegardes.

> **Correction** : mon estimation précédente de 15 à 20 €/mois était fausse. Elle reposait sur des prix d'entrée de gamme, qui ne permettent pas de compiler Android (il faut 8 Go de RAM). Le prix réel du serveur adapté est 30,49 €.

Points à vérifier avant commande :
- la page du CPX32 indique « currently unavailable » au moment de la consultation : vérifier la disponibilité dans la console ;
- Hetzner facture à l'heure, plafonné au mois : un arrêt définitif évite la facturation du mois suivant ;
- les prix sont ceux des pages publiques consultées ; ils peuvent évoluer (Hetzner a relevé ses gammes partagées en 2026).

---

## 2. Architecture

```
Galaxy A14 ──(Tailscale, réseau chiffré)──► VM Ubuntu 24.04 (CPX32)
                                            │  https://<vm>.<tailnet>.ts.net        → :443  → 127.0.0.1:3000 (interface)
                                            │  https://<vm>.<tailnet>.ts.net:8443   → :8443 → 127.0.0.1:4000 (API)
                                            ├─ docker compose
                                            │   postgres, redis (127.0.0.1 seulement)
                                            │   migrate (one-shot), backend, frontend
                                            │   worker  → lance les conteneurs de compilation (socket Docker)
                                            │   apk-egress-proxy (liste blanche) ← réseau interne apk-build-net
                                            └─ ufw : entrée refusée sauf tailscale0 (et SSH en secours)
```

Aucun port n'est publié sur une interface publique : `docker-compose.yml` lie chaque port publié à `127.0.0.1`, et `tailscale serve` (pas `funnel`) relie ces ports au tailnet.

---

## 3. Dimensionnement : 4 vCPU / 8 Go

| Service | Limite mémoire | Limite CPU | Remarque |
|---|---|---|---|
| postgres | 1 Go | 1,0 | |
| redis | 320 Mo (maxmemory 256 Mo, `noeviction`) | 0,5 | la file ne doit jamais perdre de tâches |
| backend | 768 Mo | 1,0 | |
| frontend | 384 Mo | 0,5 | |
| worker | 768 Mo | 1,0 | ne couvre **pas** les conteneurs de compilation |
| apk-egress-proxy | 128 Mo | 0,25 | |
| **Total services** | **≈ 3,4 Go** | **≈ 4,25** | |
| **1 compilation** | **3 Go** (`BUILD_MEMORY`) | **2** (`BUILD_CPUS`) | |

- **Concurrence : 1 compilation à la fois** (`WORKER_CONCURRENCY=1`). Deux compilations simultanées feraient dépasser la RAM (≈ 6 Go de compilation + services) et le temps.
- **Disque** : workspace limité à 2 Go par build (`BUILD_MAX_WORKSPACE_MB=2048`, surveillance toutes les 5 s, conteneur arrêté au-delà) ; uploads limités à 200 Mo (ZIP) et 256 Mo par fichier extrait ; artefacts limités à 200 Mo ; purge des sources et APK après 24 h (politique de confidentialité).
- **Temps** : 25 minutes maximum par compilation (`BUILD_TIMEOUT_MS`).
- **Réseau de compilation** : `restricted` (réseau interne sans route vers Internet, seule sortie = proxy à liste blanche). Liste dans `docker/egress-proxy/allowed-domains.txt`.

Mesure à faire après installation : temps réel de la compilation de référence sur CPX32 (environ 35 s sur le poste de test, à confirmer sur la VM).

---

## 4. Accès depuis le Galaxy A14

1. Sur la VM : `tailscale up` (ouvre une URL d'authentification à valider dans le navigateur).
2. Dans la console d'administration Tailscale (https://login.tailscale.com/admin) :
   - **DNS** : activer **MagicDNS** ;
   - **DNS** : activer **HTTPS Certificates** (nécessaire pour `tailscale serve`) ;
   - **Access controls** : n'autoriser que votre compte (et vos appareils) ; ne jamais activer **Funnel** pour cette machine.
3. Sur le Galaxy A14 : installer l'application **Tailscale** (Play Store), se connecter avec le **même compte**, activer la connexion.
4. Ouvrir dans Chrome : `https://<vm>.<tailnet>.ts.net` (le nom exact est affiché par `tailscale status`).

Sans l'application Tailscale active sur le téléphone, l'adresse n'est pas joignable : c'est voulu.

---

## 5. Sauvegardes

- **Chiffrement obligatoire** : `backup.sh` refuse de tourner sans `BACKUP_AGE_RECIPIENT`. Les sauvegardes sont chiffrées avec `age`.
- **Clé** : générer la paire **sur votre poste**, pas sur la VM :
  ```bash
  age-keygen -o apk-factory-backup.key      # garder ce fichier HORS de la VM (gestionnaire de mots de passe, clé USB)
  grep 'public key' apk-factory-backup.key  # la clé publique va dans .env de la VM (BACKUP_AGE_RECIPIENT)
  ```
  Sans la clé privée, les sauvegardes sont inutilisables : la conserver en deux exemplaires.
- **Contenu** : base PostgreSQL (comptes avec mots de passe hachés, projets, historiques, journaux de compilation). **Sans** les fichiers uploadés (`BACKUP_UPLOADS=false` par défaut) : sources et APK sont supprimés après 24 h par la politique de confidentialité, et une sauvegarde les conserverait plus longtemps. Activer `BACKUP_UPLOADS=true` seulement si ce compromis est accepté.
- **Planification** (exemple, à installer sur la VM) :
  ```
  # /etc/cron.d/apk-factory-backup
  30 3 * * * root cd /opt/apk-factory && BACKUP_AGE_RECIPIENT=age1... BACKUP_REMOTE=u123@u123.your-storagebox.de:apk-factory/ scripts/vps/backup.sh >> /var/log/apk-backup.log 2>&1
  ```
- **Restauration de la base** : `BACKUP_AGE_IDENTITY=/chemin/apk-factory-backup.key scripts/vps/restore-db.sh <fichier.dump.age> --yes` (destructif, exige `--yes`).
- **Restauration des uploads** (seulement si `BACKUP_UPLOADS=true` a été utilisé) : `age -d -i <clé> uploads-<date>.tar.age | docker run --rm -i -v apk-factory_uploads_data:/data alpine:3.20 tar -C /data -xf -`.

Les journaux de compilation peuvent contenir des fragments de code (messages du compilateur). Ils sont donc sauvegardés chiffrés et leur rétention suit celle des builds.

---

## 6. Installation reproductible

Sur une VM Ubuntu 24.04 neuve, en root :

```bash
# 1. Prérequis manuels : VM créée, tailscale up, MagicDNS et HTTPS activés (section 4)
# 2. Installation (idempotente) :
sudo APK_REF=<branche-ou-tag> /path/to/install.sh     # ou : curl/git clone puis scripts/vps/install.sh
# 3. Compte propriétaire (l'inscription publique est fermée) :
printf '%s' 'mot-de-passe-d-au-moins-12-caracteres' | docker compose exec -T backend npm run -s user:create -- vous@example.com 'Votre Nom' --stdin
# 4. Ouvrir FRONTEND_URL depuis le Galaxy A14 (section 4).
```

`scripts/vps/install.sh --dry-run` affiche toutes les étapes sans rien exécuter. Il fait : contrôle de l'hôte (4 vCPU, 8 Go, Ubuntu 24.04), Docker et Tailscale, pare-feu ufw (entrée refusée sauf `tailscale0`), répertoires `/srv/apk-factory`, code à la référence demandée, `.env` avec secrets générés une seule fois (jamais écrasé), construction des images, démarrage, publication par `tailscale serve`.

Mise à jour : relancer `install.sh --ref <nouvelle-ref>` (les secrets et les données sont conservés).

Retour arrière : `git -C /opt/apk-factory checkout <ancienne-ref>` puis `docker compose up -d --build` ; la base n'est pas modifiée par un retour arrière de code, mais une migration irréversible doit être restaurée depuis une sauvegarde.

---

## 7. Limites de sécurité (à lire avant d'inviter quelqu'un)

- **Le worker tient le socket Docker de l'hôte** : une compromission du worker équivaut à un accès root sur la VM. Acceptable pour le propriétaire et des projets de confiance ; **insuffisant pour des tiers** (voir `docs/V1-DEMO.md` et le plan de sécurisation).
- **Les conteneurs de compilation partagent le noyau de la VM** (runc). gVisor n'est pas testé.
- **Une seule VM** : une panne ou une perte de la VM arrête le service ; les sauvegardes hors VM permettent de reconstruire la base, pas le service en continu.
- **Pas de supervision** dans cette version (pas d'alerte si la VM tombe ou si la file se bloque).
- **Mots de passe** : `ALLOW_PUBLIC_REGISTRATION=false` ferme l'inscription, mais la connexion reste ouverte à quiconque connaît un compte. Le réseau privé Tailscale est la vraie barrière : ne donnez accès qu'aux appareils de confiance.
- **Clé Anthropic** : si `ANTHROPIC_API_KEY` est renseignée, des messages d'erreur et des fichiers Gradle sont envoyés à Anthropic pour la correction automatique (voir la politique de confidentialité).
- **SSH** reste ouvert en secours sur le pare-feu : l'idéal est de le fermer une fois Tailscale SSH configuré.
