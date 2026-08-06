package web

import (
	"embed"
	"io/fs"
	"net/http"

	"proc-man/internal/spa"
)

//go:embed all:dist
var assets embed.FS

func Handler() http.Handler {
	root, err := fs.Sub(assets, "dist")
	if err != nil {
		panic(err)
	}
	return spa.FileSystem(root)
}
