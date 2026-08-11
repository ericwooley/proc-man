# frozen_string_literal: true

class ProcManCi < Formula
  desc "Test proc-man startup and user service installation"
  homepage "https://github.com/ericwooley/proc-man"
  url "file://#{File.expand_path("../proc-man-ci.tar.gz", __dir__)}"
  version "ci"
  sha256 "PROC_MAN_CI_SHA256"

  def install
    bin.install "proc-man"
  end

  def post_install
    system bin/"proc-man", "daemon", "install", "--now"
  end

  test do
    system bin/"proc-man", "--help"
  end
end
