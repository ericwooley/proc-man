package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	BaseURL string
	HTTP    *http.Client
}

type APIError struct {
	Status  int
	Code    string
	Message string
	Details any
}

func (err *APIError) Error() string {
	if err.Code == "" {
		return err.Message
	}
	return err.Code + ": " + err.Message
}

func New(baseURL string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP:    &http.Client{Timeout: 30 * time.Second},
	}
}

func (client *Client) JSON(
	ctx context.Context,
	method string,
	path string,
	input any,
	output any,
) error {
	var body io.Reader
	if input != nil {
		var buffer bytes.Buffer
		if err := json.NewEncoder(&buffer).Encode(input); err != nil {
			return err
		}
		body = &buffer
	}
	request, err := http.NewRequestWithContext(ctx, method, client.BaseURL+path, body)
	if err != nil {
		return err
	}
	if input != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.HTTP.Do(request)
	if err != nil {
		return fmt.Errorf("connect to proc-man at %s: %w", client.BaseURL, err)
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		var payload struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
				Details any    `json:"details"`
			} `json:"error"`
		}
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return &APIError{
			Status: response.StatusCode, Code: payload.Error.Code,
			Message: payload.Error.Message, Details: payload.Error.Details,
		}
	}
	if output == nil || response.StatusCode == http.StatusNoContent {
		return nil
	}
	return json.NewDecoder(response.Body).Decode(output)
}

func (client *Client) Download(ctx context.Context, path string, output io.Writer) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.BaseURL+path, nil)
	if err != nil {
		return err
	}
	response, err := client.HTTP.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		return fmt.Errorf("download failed: %s", response.Status)
	}
	_, err = io.Copy(output, response.Body)
	return err
}

func Query(path string, values url.Values) string {
	if len(values) == 0 {
		return path
	}
	return path + "?" + values.Encode()
}
