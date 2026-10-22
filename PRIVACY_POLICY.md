# Privacy Policy — APK Factory by Aiworkpay

**Dernière mise à jour : 12 avril 2026**  
**Éditeur : Aiworkpay SASU (Ahmed Akafou)**  
**Contact : aapro78@gmail.com**

---

## 1. Introduction

L'application APK Factory est un outil de développement permettant de compiler des projets Android depuis des dépôts GitHub vers des formats APK ou AAB. La présente politique détaille la manière dont nous traitons vos données techniques et personnelles.

---

## 2. Collecte et Utilisation des Données

Pour fonctionner, APK Factory traite les types de données suivants :

**Données de Code Source**  
Nous accédons temporairement aux dépôts GitHub que vous nous fournissez pour effectuer la compilation. Le code n'est ni stocké ni partagé après la fin du processus de build.

**Fichiers de Signature (Keystores)**  
Les fichiers `.jks` ou `.keystore` téléchargés pour signer vos applications sont chiffrés et utilisés uniquement durant la phase de build. Ils ne sont jamais accessibles par des tiers.

**Correction automatique par IA (Anthropic)**  
Lorsque la correction automatique est activée, nous utilisons l'API d'Anthropic (modèles Claude) pour analyser et corriger les erreurs de compilation. Seuls les messages d'erreur du build et le contenu des fichiers de configuration Gradle (`build.gradle`, `settings.gradle`, `gradle.properties`) sont transmis, via une connexion HTTPS. Le reste de votre code source, vos keystores et toute donnée permettant de vous identifier personnellement ne sont pas transmis. Si aucune clé API n'est configurée, des règles de correction locales sont utilisées et aucune donnée n'est envoyée à un tiers.

---

## 3. Droits d'Accès Android

L'application peut demander les permissions suivantes :

- **Accès Internet** : Requis pour cloner les dépôts et communiquer avec le serveur de build.
- **Stockage (Lecture/Écriture)** : Uniquement pour sauvegarder l'APK ou l'AAB généré sur votre appareil.

---

## 4. Sécurité des Données

Conformément au RGPD et aux règles de Google Play, Aiworkpay s'engage à :

- Ne jamais vendre vos données de projet à des tiers.
- Supprimer automatiquement les artefacts de build (APK/AAB, codes QR) et les fichiers sources de vos projets 24 heures après la fin du dernier build (durée configurable côté serveur).
- Utiliser des serveurs sécurisés basés en Europe pour le traitement des données.

---

## 5. Suppression des Données

Vous pouvez demander la suppression de votre historique de build et de vos fichiers de signature à tout moment en envoyant un email à **aapro78@gmail.com**. Vous pouvez aussi supprimer vous-même, à tout moment, votre historique de build et vos fichiers, ou votre compte entier, depuis la page *Paramètres* de l'application.

---

## 6. Contact

Pour toute question relative à la présente politique de confidentialité :

**Aiworkpay SASU**  
Ahmed Akafou  
aapro78@gmail.com
