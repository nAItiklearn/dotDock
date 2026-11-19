# Source this before local Rust builds: puts WinLibs (modern MinGW-w64) ahead of the
# old C:\MinGW toolchain so gcc/dlltool match the x86_64-pc-windows-gnu target.
# Release (MSVC) builds happen in GitHub Actions; see docs/DECISIONS.md D-005.
for d in "$LOCALAPPDATA"/Microsoft/WinGet/Packages/BrechtSanders.WinLibs*/mingw64/bin; do
  [ -d "$d" ] && export PATH="$(cygpath -u "$d"):$PATH" && break
done
