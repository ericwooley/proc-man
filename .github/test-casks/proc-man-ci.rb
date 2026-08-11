# frozen_string_literal: true

cask "proc-man-ci" do
  version "ci"
  sha256 :no_check

  url "file://#{File.expand_path("../proc-man-ci.tar.gz", __dir__)}"
  name "proc-man CI"
  desc "Test proc-man startup and user service installation"
  homepage "https://github.com/ericwooley/proc-man"

  binary "proc-man"

  postflight do
    executable = "#{staged_path}/proc-man"
    replacement = "#{staged_path}/.proc-man-replacement"
    FileUtils.copy_file executable, replacement
    FileUtils.chmod 0755, replacement
    FileUtils.mv replacement, executable, force: true
    system_command executable, args: ["daemon", "install", "--now"]
  end

  uninstall_preflight do
    system_command "#{staged_path}/proc-man", args: ["daemon", "uninstall"]
  end
end
