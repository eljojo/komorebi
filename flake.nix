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
          # `nix run .#build` — the general deploy bundle for no-build embeds:
          #   dist/komorebi.player.min.js  IIFE global (window.Komorebi), every SHIPPED look
          # The experimental looks are not in it, and they are the only looks that use a camera other than
          # the floor, so their cameras go too. embed-build.mjs holds the definition of both bundles.
          # The editor and player.html in this repo import the ES modules directly and need no bundle.
          build = pkgs.writeShellApplication {
            name = "build";
            runtimeInputs = [ pkgs.bun pkgs.gzip pkgs.nodejs_22 ];
            text = ''exec node embed-build.mjs'';
          };
          # `nix run .#pixels [preset...]` — the pixel harness: renders every look in headless Chromium
          # (real WebGL2 / SwiftShader), writes PNGs to test-gl/out/, and runs the smoke + gate-invariant +
          # determinism + transition-routing suites. First run needs its browsers: cd test-gl && npm install && npx playwright
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
          # `nix run .#embed -- '<look>'...` — the one-page bundle: only the named looks, only the cameras
          # they select. Writes dist/komorebi.embed.min.js. Verify it with `nix run .#embed-check`.
          embed = pkgs.writeShellApplication {
            name = "embed";
            runtimeInputs = [ pkgs.bun pkgs.gzip pkgs.nodejs_22 ];
            text = ''exec node embed-build.mjs "$@"'';
          };
          # `nix run .#embed-check -- '<look>'...` — the embed bundle's proof: every kept look rendered
          # through dist/komorebi.embed.min.js AND through the raw ES modules, in one page, compared byte
          # for byte. `--against <bundle.js>` also diffs an older deploy and writes a contact sheet.
          # Same first-run setup as pixels: cd test-gl && npm install && npx playwright install chromium.
          embed-check = pkgs.writeShellApplication {
            name = "embed-check";
            runtimeInputs = [ pkgs.nodejs_22 ];
            text = ''
              cd test-gl
              if [ ! -d node_modules ]; then
                echo "first run: cd test-gl && npm install && npx playwright install chromium" >&2
                exit 1
              fi
              exec node embed.mjs "$@"
            '';
          };
          # `nix run .#editor` — the editor smoke: drives index.html's mode ladder + macro bus in headless
          # Chromium and asserts the observable DOM effects (UI-only regressions the pixel suites can't see).
          # Same first-run setup as pixels: cd test-gl && npm install && npx playwright install chromium.
          editor = pkgs.writeShellApplication {
            name = "editor";
            runtimeInputs = [ pkgs.nodejs_22 ];
            text = ''
              cd test-gl
              if [ ! -d node_modules ]; then
                echo "first run: cd test-gl && npm install && npx playwright install chromium" >&2
                exit 1
              fi
              exec node editor.mjs "$@"
            '';
          };
        in {
          dev = { type = "app"; program = "${dev}/bin/dev"; };
          lint = { type = "app"; program = "${lint}/bin/lint"; };
          build = { type = "app"; program = "${build}/bin/build"; };
          pixels = { type = "app"; program = "${pixels}/bin/pixels"; };
          editor = { type = "app"; program = "${editor}/bin/editor"; };
          embed = { type = "app"; program = "${embed}/bin/embed"; };
          embed-check = { type = "app"; program = "${embed-check}/bin/embed-check"; };
          default = self.apps.${pkgs.system}.dev;
        });
    };
}
