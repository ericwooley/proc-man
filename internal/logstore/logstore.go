package logstore

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"proc-man/internal/domain"
)

type Writer struct {
	mu       sync.Mutex
	file     *os.File
	sequence int64
	now      func() time.Time
	onRecord func(domain.LogRecord)
}

func Create(root, runID string, onRecord func(domain.LogRecord)) (*Writer, string, error) {
	directory := filepath.Join(root, runID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, "", fmt.Errorf("create run log directory: %w", err)
	}
	path := filepath.Join(directory, "000001.ndjson")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, "", fmt.Errorf("open run log: %w", err)
	}
	return &Writer{file: file, now: time.Now, onRecord: onRecord}, path, nil
}

func (writer *Writer) Append(stream, text string, partial bool) error {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	writer.sequence++
	record := domain.LogRecord{
		Sequence: writer.sequence,
		Time:     writer.now().UTC(),
		Stream:   stream,
		Text:     text,
		Partial:  partial,
	}
	bytes, err := json.Marshal(record)
	if err != nil {
		return err
	}
	if _, err := writer.file.Write(append(bytes, '\n')); err != nil {
		return fmt.Errorf("append run log: %w", err)
	}
	if writer.onRecord != nil {
		writer.onRecord(record)
	}
	return nil
}

func (writer *Writer) Stream(stream string) *LineWriter {
	return &LineWriter{writer: writer, stream: stream}
}

func (writer *Writer) Close() error {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	return writer.file.Close()
}

type LineWriter struct {
	mu     sync.Mutex
	writer *Writer
	stream string
	buffer []byte
}

func (writer *LineWriter) Write(input []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	writer.buffer = append(writer.buffer, input...)
	for {
		index := strings.IndexByte(string(writer.buffer), '\n')
		if index < 0 {
			break
		}
		line := strings.TrimSuffix(string(writer.buffer[:index]), "\r")
		if err := writer.writer.Append(writer.stream, line, false); err != nil {
			return 0, err
		}
		writer.buffer = writer.buffer[index+1:]
	}
	return len(input), nil
}

func (writer *LineWriter) Flush() error {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	if len(writer.buffer) == 0 {
		return nil
	}
	err := writer.writer.Append(writer.stream, string(writer.buffer), true)
	writer.buffer = nil
	return err
}

type Query struct {
	Text   string
	Stream string
	Since  int64
	Limit  int
}

func Read(path string, query Query) ([]domain.LogRecord, error) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.LogRecord{}, nil
		}
		return nil, fmt.Errorf("open run log: %w", err)
	}
	defer file.Close()
	if query.Limit <= 0 || query.Limit > 100_000 {
		query.Limit = 10_000
	}
	needle := strings.ToLower(query.Text)
	records := make([]domain.LogRecord, 0)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		var record domain.LogRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			return nil, fmt.Errorf("decode run log: %w", err)
		}
		if record.Sequence <= query.Since {
			continue
		}
		if query.Stream != "" && record.Stream != query.Stream {
			continue
		}
		if needle != "" && !strings.Contains(strings.ToLower(record.Text), needle) {
			continue
		}
		records = append(records, record)
		if len(records) >= query.Limit {
			break
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan run log: %w", err)
	}
	return records, nil
}

func DownloadText(output io.Writer, records []domain.LogRecord) error {
	for _, record := range records {
		if _, err := fmt.Fprintf(output, "%s %s %s\n",
			record.Time.Format(time.RFC3339Nano), record.Stream, record.Text,
		); err != nil {
			return err
		}
	}
	return nil
}
