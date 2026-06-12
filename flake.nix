{
  description = "Komorebi — WebGL2 komorebi engine: bun dev server + lint + bundle helpers";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      # `nix develop` — bun (dev server + bundler) + biome (lint) on PATH.
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.bun pkgs.biome ];
          shellHook = ''
            echo "komorebi dev shell — dev: nix run .#dev | lint: nix run .#lint | bundle: nix run .#build"
          '';
        };
      });

      apps = forAll (pkgs:
        let
          # `nix run .#dev [port]` — bun static server with live-reload (default 8000). ES-module dev
          # needs http, not file://; this serves komorebi.js / presets.js raw and reloads tabs on save.
          dev = pkgs.writeShellApplication {
            name = "dev";
            runtimeInputs = [ pkgs.bun ];
            text = ''exec bun dev-server.js "''${1:-8000}"'';
          };
          # `nix run .#lint [files...]` — lint the hand-written JS (defaults to the engine + the pure modules;
          # editor.js is relocated legacy and not yet biome-clean, so it's opt-in via an explicit arg).
          lint = pkgs.writeShellApplication {
            name = "lint";
            runtimeInputs = [ pkgs.biome ];
            text = ''
              if [ "$#" -eq 0 ]; then
                exec biome lint komorebi.js presets.js profiler.js presets-store.js
              else
                exec biome lint "$@"
              fi
            '';
          };
          # `nix run .#build` — bundle the deploy artifact for external no-build embeds (eljojo.net):
          #   dist/komorebi.player.min.js  IIFE global (window.Komorebi), editor overlays dead-stripped
          # via --define:KOMOREBI_EDITOR=false. The editor + player.html in this repo import the ES
          # modules directly and need no bundle.
          build = pkgs.writeShellApplication {
            name = "build";
            runtimeInputs = [ pkgs.bun pkgs.gzip pkgs.coreutils ];
            text = ''
              mkdir -p dist
              bun build ./komorebi.global.js --minify --format=iife \
                --define KOMOREBI_EDITOR=false --outfile=dist/komorebi.player.min.js
              printf '%-32s %9s %9s\n' file raw gzip
              for f in komorebi.js presets.js dist/komorebi.player.min.js; do
                printf '%-32s %9d %9d\n' "$f" "$(wc -c <"$f")" "$(gzip -c "$f" | wc -c)"
              done
            '';
          };
        in {
          dev = { type = "app"; program = "${dev}/bin/dev"; };
          lint = { type = "app"; program = "${lint}/bin/lint"; };
          build = { type = "app"; program = "${build}/bin/build"; };
          default = self.apps.${pkgs.system}.dev;
        });
    };
}
