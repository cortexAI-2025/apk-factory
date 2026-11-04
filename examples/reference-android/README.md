# Reference Android project

Smallest native Android Gradle project used to prove the APK Factory pipeline
(ZIP → build → debug APK → install). It shows one recognisable screen:
**"APK Factory Reference OK"**.

- Java only, no AndroidX / no third-party dependency (only AGP 8.2.2 from Google Maven).
- Gradle 8.2.1 wrapper committed (`gradlew`, `gradle/wrapper/gradle-wrapper.jar`).
- Package: `com.apkfactory.reference`, minSdk 24, targetSdk 34.

Rebuild the ZIP: `bash scripts/make-reference-zip.sh`.
