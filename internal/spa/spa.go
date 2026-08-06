package spa

import (
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

func Directory(root string) http.Handler {
	files := os.DirFS(root)
	return FileSystem(files)
}

func FileSystem(files fs.FS) http.Handler {
	server := http.FileServer(http.FS(files))
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		name := strings.TrimPrefix(path.Clean(request.URL.Path), "/")
		if name == "." {
			name = "index.html"
		}
		if _, err := fs.Stat(files, name); err == nil {
			server.ServeHTTP(response, request)
			return
		}
		request.URL.Path = "/"
		server.ServeHTTP(response, request)
	})
}
