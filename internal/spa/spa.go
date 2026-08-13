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
		if assetName, ok := rootAssetName(name); ok {
			if _, err := fs.Stat(files, assetName); err == nil {
				request.URL.Path = "/" + assetName
				server.ServeHTTP(response, request)
				return
			}
		}
		request.URL.Path = "/"
		server.ServeHTTP(response, request)
	})
}

func rootAssetName(name string) (string, bool) {
	const marker = "/assets/"
	index := strings.Index(name, marker)
	if index < 0 {
		return "", false
	}
	return name[index+1:], true
}
