// Command uicss prints the CSS made from ui.json (the site's build and the web build use it).
package main

import (
	"fmt"
	"os"

	"ravazque.info/server/core"
)

func main() {
	cfg, err := core.LoadUI()
	if err != nil {
		fmt.Fprintln(os.Stderr, "uicss:", err)
		os.Exit(1)
	}
	if errs := core.ValidateUI(cfg); len(errs) > 0 {
		for _, e := range errs {
			fmt.Fprintln(os.Stderr, "ui.json:", e)
		}
		os.Exit(1)
	}
	fmt.Print(core.CSSFromUI(cfg))
}
