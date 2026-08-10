# Releasing

## Release outputs

A version tag creates GitHub Release archives for these targets:

- macOS on AMD64 and ARM64.
- Linux on AMD64 and ARM64.
- Windows on AMD64 and ARM64.

Windows uses ZIP archives.
macOS and Linux use compressed TAR archives.
Each release also contains `checksums.txt`.

## Homebrew tap

The release workflow publishes a Homebrew cask to `ericwooley/homebrew-tap`.
The cask supports macOS and Linux.
Create that repository before the first release.

Add the `HOMEBREW_TAP_GITHUB_TOKEN` Actions secret to this repository.
The token needs content write access to the tap repository.
The default GitHub Actions token cannot write to another repository.

[Homebrew requires explicit trust](https://docs.brew.sh/Tap-Trust) for non-official taps.
Use the fully qualified cask name to trust only proc-man:

```sh
brew install --cask ericwooley/tap/proc-man
```

Homebrew adds `ericwooley/tap` during this installation.
Users can also add the tap first:

```sh
brew tap ericwooley/tap
brew install --cask ericwooley/tap/proc-man
```

## Create a release

1. Confirm that the release commit is on the default branch.
2. Create a semantic version tag such as `v0.1.0`.
3. Push the tag to GitHub.
4. Check the Release workflow result.
5. Confirm the archives and Homebrew cask.

The workflow builds the React application before GoReleaser builds each binary.
GoReleaser sets the CLI version from the Git tag.
