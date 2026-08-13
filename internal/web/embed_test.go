package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"path"
	"regexp"
	"strings"
	"testing"
)

var assetReferencePattern = regexp.MustCompile(`(?:src|href)="([^"]*assets/[^"]+)"`)

func TestHandlerServesAssetsFromDirectProcessRoute(t *testing.T) {
	handler := Handler()
	documentPath := "/process/proc_direct"
	document := serve(t, handler, documentPath)

	if document.Code != http.StatusOK {
		t.Fatalf("GET %s returned %d, want %d", documentPath, document.Code, http.StatusOK)
	}

	references := assetReferencePattern.FindAllStringSubmatch(document.Body.String(), -1)
	if len(references) == 0 {
		t.Fatal("process page contains no asset references")
	}

	documentURL, err := url.Parse("http://proc-man.test" + documentPath)
	if err != nil {
		t.Fatalf("parse document URL: %v", err)
	}

	for _, match := range references {
		reference, err := url.Parse(match[1])
		if err != nil {
			t.Fatalf("parse asset reference %q: %v", match[1], err)
		}
		assetPath := documentURL.ResolveReference(reference).Path
		response := serve(t, handler, assetPath)

		if response.Code != http.StatusOK {
			t.Errorf("GET %s returned %d, want %d", assetPath, response.Code, http.StatusOK)
			continue
		}

		contentType := response.Header().Get("Content-Type")
		var expectedType string
		switch path.Ext(assetPath) {
		case ".css":
			expectedType = "text/css"
		case ".js":
			expectedType = "text/javascript"
		default:
			t.Errorf("asset %s has an untested extension", assetPath)
			continue
		}
		if !strings.HasPrefix(contentType, expectedType) {
			t.Errorf("GET %s returned Content-Type %q, want prefix %q", assetPath, contentType, expectedType)
		}
	}
}

func serve(t *testing.T, handler http.Handler, requestPath string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, requestPath, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
