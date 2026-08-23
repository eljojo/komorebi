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
          # python3 + a bare-`python` alias: node-gyp native builds (headless-gl's vendored ANGLE
          # shells out to plain `python`) need both on PATH — nixpkgs ships only `python3`.
          packages = [ pkgs.bun pkgs.biome pkgs.python3
            (pkgs.writeShellScriptBin "python" ''exec ${pkgs.python3}/bin/python3 "$@"'') ];
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
          # `nix run .#lint [files...]` — lint ALL hand-written JS by default (the generated bundle under dist/ is
          # excluded in biome.jsonc). Pass explicit paths to lint a subset.
          lint = pkgs.writeShellApplication {
            name = "lint";
            runtimeInputs = [ pkgs.biome ];
            text = ''
              if [ "$#" -eq 0 ]; then
                exec biome lint .
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
          # `nix run .#pixels [preset...]` — the pixel harness: renders every look in headless Chromium
          # (real WebGL2 / SwiftShader), writes PNGs to test-gl/out/, and runs the smoke + gate-invariant +
          # determinism suites. First run needs its browsers: cd test-gl && npm install && npx playwright
          # install chromium (cached under ~/.cache thereafter; deliberately outside nix — Playwright pins
          # its own Chromium build).
          pixels = pkgs.writeShellApplication {
            name = "pixels";
            runtimeInputs = [ pkgs.nodejs_22 ];
            text = ''
              cd test-gl
              if [ ! -d node_modules ]; then
                echo "first run: cd test-gl && npm install && npx playwright install chromium" >&2
                exit 1
              fi
              exec node run.js "$@"
            '';
          };
        in {
          dev = { type = "app"; program = "${dev}/bin/dev"; };
          lint = { type = "app"; program = "${lint}/bin/lint"; };
          build = { type = "app"; program = "${build}/bin/build"; };
          pixels = { type = "app"; program = "${pixels}/bin/pixels"; };
          default = self.apps.${pkgs.system}.dev;
        });
    };
}
