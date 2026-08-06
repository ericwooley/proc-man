package main

import (
	"context"
	"fmt"
	"os"

	"proc-man/internal/cli"
)

var version = "dev"

func main() {
	err := cli.ExecuteContext(context.Background(), version)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
	}
	os.Exit(cli.ExitCode(err))
}
