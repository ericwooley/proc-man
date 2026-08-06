package logstore

import (
	"bytes"
	"path/filepath"
	"testing"
)

func TestWriteReadAndDownload(t *testing.T) {
	t.Parallel()
	writer, path, err := Create(t.TempDir(), "run_one", nil)
	if err != nil {
		t.Fatal(err)
	}
	stdout := writer.Stream("stdout")
	stderr := writer.Stream("stderr")
	if _, err := stdout.Write([]byte("ready\npartial")); err != nil {
		t.Fatal(err)
	}
	if _, err := stderr.Write([]byte("upstream timeout\n")); err != nil {
		t.Fatal(err)
	}
	if err := stdout.Flush(); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	records, err := Read(path, Query{Text: "TIMEOUT", Stream: "stderr"})
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].Text != "upstream timeout" {
		t.Fatalf("Records = %#v", records)
	}
	all, err := Read(path, Query{})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 || !all[2].Partial {
		t.Fatalf("All records = %#v", all)
	}
	var output bytes.Buffer
	if err := DownloadText(&output, all); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(output.Bytes(), []byte("ready")) {
		t.Fatalf("Download = %q", output.String())
	}
	if filepath.Base(path) != "000001.ndjson" {
		t.Fatalf("Path = %q", path)
	}
}
