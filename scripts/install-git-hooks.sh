#!/bin/sh
set -eu

repository=$(git rev-parse --show-toplevel)
git -C "$repository" config core.hooksPath .githooks
printf 'Installed proc-man Git hooks for %s\n' "$repository"
