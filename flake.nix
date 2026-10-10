{
  description = "komorebi-arboretum: where komorebi looks are kept and grouped";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, utils, ... }:
    utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        # The dev mode: arboretum plus a komorebi checkout at /editor/ on one https origin (scripts/dev.mjs).
        # It runs from the repo root, because it builds into .wrangler there and uses node_modules' wrangler.
        dev = pkgs.writeShellApplication {
          name = "arboretum-dev";
          runtimeInputs = with pkgs; [ nodejs_22 git ];
          text = ''
            cd "$(git rev-parse --show-toplevel)"
            exec node scripts/dev.mjs "$@"
          '';
        };
      in
      {
        apps.dev = {
          type = "app";
          program = "${dev}/bin/arboretum-dev";
        };

        # wrangler and vitest come from package.json, not from here.
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            git
          ];
        };
      });
}
