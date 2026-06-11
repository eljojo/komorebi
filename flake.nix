{
  description = "Komorebi — WebGL2 komorebi engine: dev shell + serve/lint/build helpers";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      # `nix develop` — python3 (dev server) + biome (lint) + terser (minify) on PATH.
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.python3 pkgs.biome pkgs.terser ];
          shellHook = ''
            echo "komorebi dev shell — serve: python3 -m http.server 8000 | lint: biome lint komorebi.js | build: nix run .#build"
          '';
        };
      });

      apps = forAll (pkgs:
        let
          # `nix run .#serve [port]` — static server for the repo (default port 8000).
          serve = pkgs.writeShellApplication {
            name = "serve";
            runtimeInputs = [ pkgs.python3 ];
            text = ''exec python3 -m http.server "''${1:-8000}"'';
          };
          # `nix run .#lint [files...]` — lint JS (defaults to komorebi.js).
          lint = pkgs.writeShellApplication {
            name = "lint";
            runtimeInputs = [ pkgs.biome ];
            text = ''
              if [ "$#" -eq 0 ]; then
                exec biome lint komorebi.js
              else
                exec biome lint "$@"
              fi
            '';
          };
          # `nix run .#build` — minified builds from komorebi.js:
          #   komorebi.min.js         full engine, editor included
          #   komorebi.player.min.js  EDITOR=false — debug-overlay insets dead-stripped (for the eljojo.net viewer)
          build = pkgs.writeShellApplication {
            name = "build";
            runtimeInputs = [ pkgs.terser pkgs.gnused pkgs.gzip pkgs.coreutils ];
            text = ''
              src=komorebi.js
              mkdir -p dist
              terser "$src" -c passes=3 -m -o dist/komorebi.min.js
              sed 's/const EDITOR = true;/const EDITOR = false;/' "$src" | terser -c passes=3 -m -o dist/komorebi.player.min.js
              printf '%-28s %9s %9s\n' file raw gzip
              for f in "$src" dist/komorebi.min.js dist/komorebi.player.min.js; do
                printf '%-28s %9d %9d\n' "$f" "$(wc -c <"$f")" "$(gzip -c "$f" | wc -c)"
              done
            '';
          };
        in {
          serve = { type = "app"; program = "${serve}/bin/serve"; };
          lint = { type = "app"; program = "${lint}/bin/lint"; };
          build = { type = "app"; program = "${build}/bin/build"; };
          default = self.apps.${pkgs.system}.serve;
        });
    };
}
