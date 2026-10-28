// Command ravazque-info is the web server: one process, its memory the only store.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ravazque.info/server/internal/app"
	"ravazque.info/server/internal/web"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	s := app.SettingsFromEnv()
	if err := s.Check(); err != nil {
		slog.Error("settings", "error", err.Error())
		os.Exit(1)
	}
	srv := web.New(s, web.Static(), web.Options{})
	defer srv.Close()
	hs := &http.Server{Addr: s.Addr, Handler: srv, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: time.Minute,
		WriteTimeout: 2 * time.Minute, IdleTimeout: 2 * time.Minute, MaxHeaderBytes: 64 << 10}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shut, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		hs.Shutdown(shut)
	}()
	slog.Info("listening", "addr", s.Addr, "base", s.BaseURL)
	if err := hs.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server", "error", err.Error())
		os.Exit(1)
	}
}
