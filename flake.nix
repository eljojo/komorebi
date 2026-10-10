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
        # The dev mode: arboretum plus a komorebi checkout at the root on one https origin (scripts/dev.mjs).
        # It runs from the repo root, because it builds into .wrangler there and uses node_modules' wrangler.
        dev = pkgs.writeShellApplication {
          name = "arboretum-dev";
          runtimeInputs = with pkgs; [ nodejs_22 git ];
          text = ''
            cd "$(git rev-parse --show-toplevel)"
            exec node scripts/dev.mjs "$@"
          '';
        };
        # The deploy, start to finish: install exactly the lockfile, typecheck and test, build the site (komorebi at the
        # pinned commit at the root, public/ under arboretum/, into the gitignored .site/), apply the D1 migrations to
        # the live database, then let wrangler build and upload the Worker and that site. Any failing step stops it
        # before anything reaches Cloudflare; the migration step asks before it touches the live database.
        deploy = pkgs.writeShellApplication {
          name = "arboretum-deploy";
          runtimeInputs = with pkgs; [ nodejs_22 git ];
          text = ''
            cd "$(git rev-parse --show-toplevel)"
            npm ci
            npm run typecheck
            npm test
            node scripts/site.mjs
            npx wrangler d1 migrations apply komorebi-arboretum --remote
            npx wrangler deploy
          '';
        };
        # Follow komorebi: `nix run .#pin` pins the engine to ~/code/komorebi's local main (its newest commit, pushed
        # or not); `nix run .#pin -- <commit>` pins any other. Commit the result, and deploy when it should go live.
        pin = pkgs.writeShellApplication {
          name = "arboretum-pin";
          runtimeInputs = with pkgs; [ nodejs_22 git ];
          text = ''
            cd "$(git rev-parse --show-toplevel)"
            exec node scripts/pin-engine.mjs "''${1:-main}"
          '';
        };
      in
      {
        apps.pin = {
          type = "app";
          program = "${pin}/bin/arboretum-pin";
        };

        apps.deploy = {
          type = "app";
          program = "${deploy}/bin/arboretum-deploy";
        };

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
