/**
 * When a Gradle build fails inside a native (CMake/ndk-build) step, the AGP error ("[CXX1210] ... No
 * compatible library found") says nothing about the cause: CMake's own output is written to
 * `.cxx/<variant>/<hash>/<abi>/*.txt` and never reaches the Gradle console. This installs an EXIT trap
 * (before the Gradle command, which stays the last line of the script and keeps its exit code) that prints
 * the tail of those files when the script fails.
 */
export function nativeBuildDiagnosticsTrap(): string {
  return [
    'apk_factory_native_diag() {',
    '  rc=$?; [ "$rc" -ne 0 ] || return 0',
    '  echo "[diagnostics] build failed (exit $rc); native build logs, if any:"',
    '  find "${WORKSPACE:-/workspace}" -path "*/.cxx/*" \\( -name "configure_stdout.txt" -o -name "configure_stderr.txt" -o -name "cmake_server_log.txt" -o -name "CMakeError.log" -o -name "build_stderr.txt" \\) -size +0 2>/dev/null | head -n 8 | while IFS= read -r f; do',
    '    echo "[diagnostics] ${f#${WORKSPACE:-/workspace}/}"; tail -n 40 "$f"',
    '  done',
    '}',
    'trap apk_factory_native_diag EXIT',
  ].join('\n');
}
