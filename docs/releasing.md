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

Each push to `main` runs semantic-release.
It reads all Conventional Commits since the previous version tag.

- `fix:` creates a patch version.
- `feat:` creates a minor version.
- A `!` after the type or a `BREAKING CHANGE:` footer creates a major version.
- Other commit types do not create a version unless they contain a breaking change.

The workflow creates the version tag and GitHub Release without a release pull request.
It then builds and uploads the archives, checksums, and Homebrew cask.

To retry artifact publication for an existing tag, run the Release workflow manually and provide the tag.

The workflow builds the React application before GoReleaser builds each binary.
GoReleaser sets the CLI version from the Git tag.
