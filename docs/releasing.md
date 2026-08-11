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

The release workflow publishes a Homebrew Formula to `ericwooley/homebrew-apps`.
The Formula supports macOS and Linux.
The Formula installs the proc-man executable.
Run `proc-man daemon install --now` after installation or upgrade.
Remove the user service before removing the Formula.
Create that repository before the first release.

Add the `HOMEBREW_TAP_GITHUB_TOKEN` Actions secret to this repository.
The token needs content write access to the tap repository.
The default GitHub Actions token cannot write to another repository.

[Homebrew requires explicit trust](https://docs.brew.sh/Tap-Trust) for non-official taps.
Use the fully qualified Formula name to trust only proc-man:

```sh
brew install ericwooley/apps/proc-man
```

Homebrew adds `ericwooley/apps` during this installation.
Users can also add the tap first:

```sh
brew tap ericwooley/apps
brew install ericwooley/apps/proc-man
```

## Create a release

Each push to `main` runs semantic-release.
It reads all Conventional Commits since the previous version tag.

- `fix:` creates a patch version.
- `feat:` creates a minor version.
- A `!` after the type or a `BREAKING CHANGE:` footer creates a major version.
- Other commit types do not create a version unless they contain a breaking change.

The workflow creates the version tag and GitHub Release without a release pull request.
It then builds and uploads the archives, checksums, and Homebrew Formula.
The workflow installs the published Formula on macOS 26 ARM64.
The release passes after CLI startup and LaunchAgent checks succeed.

To retry artifact publication for an existing tag, run the Release workflow manually and provide the tag.

The workflow builds the React application before GoReleaser builds each binary.
GoReleaser sets the CLI version from the Git tag.
