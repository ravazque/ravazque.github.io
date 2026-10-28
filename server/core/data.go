// Package core holds everything computed from the 42 API data: the analysis, the insights, the access rules and the
// look of every page (ui.json → CSS). It never talks to the network.
package core

import "embed"

//go:embed data
var Data embed.FS
