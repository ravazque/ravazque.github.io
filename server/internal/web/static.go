package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Static is the built browser app (web/ builds into internal/web/dist).
func Static() fs.FS {
	sub, _ := fs.Sub(dist, "dist")
	return sub
}
