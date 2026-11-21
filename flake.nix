{
  description = "Komorebi — WebGL2 komorebi engine: bun dev server + lint + bundle helpers; arboretum, the Worker that keeps looks; komorebi-render, the server that runs its video exporter";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      # Linux renders with Nix's patched Chromium (driven by test-gl's npm Playwright, so the two must be the same version,
      # see checks.render-playwright), on Mesa's Vulkan and its VA-API encoder for AMD GPUs.
      linuxEnvironment = pkgs: pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
        PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers-chromium}";
        VK_DRIVER_FILES = "${pkgs.mesa}/share/vulkan/icd.d/radeon_icd.${pkgs.stdenv.hostPlatform.parsed.cpu.name}.json";
        LIBGL_DRIVERS_PATH = "${pkgs.mesa}/lib/dri";
        LIBVA_DRIVERS_PATH = "${pkgs.mesa}/lib/dri";
        LIBVA_DRIVER_NAME = "radeonsi";
      };
      # Only what komorebi-render and its tests need: render/ and the engine it reads its sessions, quality rows and shipped
      # playlists from. A stray file in the checkout must not change the package's hash.
      renderSource = pkgs: pkgs.lib.fileset.toSource {
        root = ./.;
        fileset = pkgs.lib.fileset.unions ([ ./engine ./komorebi.js ./presets.js ]
          ++ map (p: ./render + p) [ "/src" "/test" "/fixtures" "/package.json" "/llms.txt" "/README.md" ]);
      };
      # The komorebi commit komorebi-render renders: the one it is built from. A tree with uncommitted changes has none, and its
      # package refuses to prepare or serve (render/src/config.js, loadEngine).
      renderCommit = self.rev or null;
    in {
      # `nix develop` — bun (dev server + bundler) + biome (lint) on PATH; node and git for arboretum, whose wrangler
      # and vitest come from arboretum/package.json; node, ffmpeg and git are komorebi-render's whole toolchain. On Linux
      # it also carries the render environment above, for the exporter and test-gl/vaapi-gpu.test.mjs.
      devShells = forAll (pkgs: {
        default = pkgs.mkShell ({
          # python3 + a bare-`python` alias: node-gyp native builds (headless-gl's vendored ANGLE
          # shells out to plain `python`) need both on PATH — nixpkgs ships only `python3`.
          packages = [ pkgs.bun pkgs.biome pkgs.python3 pkgs.nodejs_22 pkgs.ffmpeg pkgs.git
            (pkgs.writeShellScriptBin "python" ''exec ${pkgs.python3}/bin/python3 "$@"'') ];
          shellHook = ''
            echo "komorebi dev shell — dev: nix run .#dev | lint: nix run .#lint | bundle: nix run .#build | arboretum: nix run .#arboretum-dev | render: nix run .#render-test"
          '';
        } // linuxEnvironment pkgs);
      });

      # komorebi-render's bin/komorebi-render. PATH is prefixed, not replaced: caffeinate lives in /usr/bin and must stay reachable.
      packages = forAll (pkgs: {
        komorebi-render = pkgs.stdenvNoCC.mkDerivation {
          pname = "komorebi-render";
          version = "0.1.0";
          src = renderSource pkgs;
          nativeBuildInputs = [ pkgs.makeWrapper ];
          dontBuild = true;
          installPhase = ''
            runHook preInstall
            mkdir -p $out/lib/komorebi-render/render $out/bin
            cp -r engine komorebi.js presets.js $out/lib/komorebi-render/
            cp -r render/src render/package.json render/llms.txt $out/lib/komorebi-render/render/
            ${pkgs.lib.optionalString (renderCommit != null) "echo ${renderCommit} > $out/lib/komorebi-render/render/commit"}
            makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/komorebi-render \
              --add-flags "--disable-warning=ExperimentalWarning $out/lib/komorebi-render/render/src/cli.js" \
              ${pkgs.lib.concatStringsSep " " (pkgs.lib.mapAttrsToList (name: value: "--set-default ${name} ${pkgs.lib.escapeShellArg value}") (linuxEnvironment pkgs))} \
              --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs_22 pkgs.ffmpeg pkgs.git ]}
            runHook postInstall
          '';
          meta.mainProgram = "komorebi-render";
        };
      });

      # komorebi-render's tests are pure: a fake exporter stands in for render-video, there is no network and no GPU.
      checks = forAll (pkgs: let render = self.packages.${pkgs.stdenv.hostPlatform.system}.komorebi-render; in {
        render-darwin-module = import ./render/nix/module-test.nix { inherit pkgs self; lib = pkgs.lib; };
        render-package = pkgs.runCommand "komorebi-render-package" {} ''
          cmp ${./render/llms.txt} ${render}/lib/komorebi-render/render/llms.txt
          ${render}/bin/komorebi-render
          echo "package: llms.txt installed and CLI wrapper runs"
          touch $out
        '';
        render-tests = pkgs.runCommand "komorebi-render-tests" { nativeBuildInputs = [ pkgs.nodejs_22 pkgs.git pkgs.ffmpeg ]; } ''
          cp -r ${renderSource pkgs} work
          chmod -R u+w work
          cd work/render
          export HOME=$TMPDIR
          node --disable-warning=ExperimentalWarning --test
          touch $out
        '';
        # Linux runs the engine's npm Playwright against Nix's Chromium; they work only at the same version.
        render-playwright = let engine = (pkgs.lib.importJSON ./test-gl/package.json).dependencies.playwright; in
          if pkgs.playwright-driver.version == engine
          then pkgs.runCommand "komorebi-render-playwright" {} "touch $out"
          else throw "nixpkgs playwright-driver ${pkgs.playwright-driver.version} does not match test-gl's Playwright ${engine} (test-gl/package.json); move nixpkgs or test-gl so they agree";
      } // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
        render-nixos-module = import ./render/nix/nixos-module-test.nix { inherit pkgs self; lib = pkgs.lib; };
      });

      # komorebi-render as a service. On the Mac the logged-in session owns the GPU and keychain, so the module runs the API and
      # worker together as a user agent; on NixOS, under systemd.
      darwinModules.komorebi-render = import ./render/nix/darwin-module.nix self;
      nixosModules.komorebi-render = import ./render/nix/nixos-module.nix self;

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
          # `nix run .#cost -- <look>... [key=value ...] [--vs key=value ...]` — what a look costs on this machine's GPU, and what a
          # change adds (test-gl/cost.mjs; its header says how it measures). Chrome on Metal; same first-run setup as pixels.
          cost = pkgs.writeShellApplication {
            name = "cost";
            runtimeInputs = [ pkgs.nodejs_22 pkgs.git ];
            text = ''
              if [ ! -d test-gl/node_modules ]; then
                echo "first run: cd test-gl && npm install && npx playwright install chromium" >&2
                exit 1
              fi
              exec node test-gl/cost.mjs "$@"
            '';
          };
          # `nix run .#pattern -- <video>... [options]` — a dappled-light video's spatio-temporal features (patch
          # clustering, spread, brightness autocorrelation, spatial and temporal spectral slopes, flow direction and
          # rhythm), for a komorebi render and a phone recording alike. test-gl/pattern.mjs's header lists the options.
          pattern = pkgs.writeShellApplication {
            name = "pattern";
            runtimeInputs = [ pkgs.nodejs_22 pkgs.ffmpeg ];
            text = ''
              exec node test-gl/pattern.mjs "$@"
            '';
          };
          # `nix run .#rows [-- key...]` — the advanced panel's rows, audited on the GPU: each row moved on a running
          # engine by the scope it asks for, held to a look born with the value, and every cheaper scope tried in its
          # place (test-gl/rows.mjs; its header says what a finding means). Chrome on Metal; same first-run setup as pixels.
          rows = pkgs.writeShellApplication {
            name = "rows";
            runtimeInputs = [ pkgs.nodejs_22 ];
            text = ''
              if [ ! -d test-gl/node_modules ]; then
                echo "first run: cd test-gl && npm install && npx playwright install chromium" >&2
                exit 1
              fi
              cd test-gl
              exec node rows.mjs "$@"
            '';
          };
          # `nix run .#embed -- '<look>'...` — the one-page bundle: only the named looks, only the cameras
          # they select, only the fall tiers they open (`--features a,b|all|none` overrides that set).
          # Writes dist/komorebi.embed.min.js. Verify it with `nix run .#embed-check`.
          embed = pkgs.writeShellApplication {
            name = "embed";
            runtimeInputs = [ pkgs.bun pkgs.gzip pkgs.nodejs_22 ];
            text = ''exec node embed-build.mjs "$@"'';
          };
          # `nix run .#embed-check -- '<look>'...` — the embed bundle's proof: the bundle for those looks (none: the
          # looks dist/komorebi.embed.min.js carries) built afresh from the working tree, each look rendered through
          # it AND through the raw ES modules, in one page, compared byte for byte. `--bundle <file.js>` checks a
          # bundle as it is; `--against <bundle.js>` also diffs an older deploy and writes a contact sheet.
          # Same first-run setup as pixels: cd test-gl && npm install && npx playwright install chromium.
          embed-check = pkgs.writeShellApplication {
            name = "embed-check";
            runtimeInputs = [ pkgs.bun pkgs.gzip pkgs.nodejs_22 ];
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
          # `nix run .#review -- spec.json [--dir <folder>] [--keep-export]` — the review-sheet tool: renders a
          # spec's judging frames from a clean `git archive` of one commit (never the working tree), lays
          # labelled sheets with quotable IDs and writes the manifest.json the review folders carry.
          # Same first-run setup as pixels: cd test-gl && npm install && npx playwright install chromium.
          review = pkgs.writeShellApplication {
            name = "review";
            runtimeInputs = [ pkgs.nodejs_22 pkgs.imagemagick pkgs.git pkgs.gnutar ];
            text = ''exec node test-gl/review.mjs "$@"'';
          };
          # `nix run .#adopt -- survey|render key=value… | cost|motion|transitions|status|apply <folder> | record` — turning a default
          # on: which built-in looks it moves, and the four questions an upgrade answers (the look, its cost a frame, the motion, the
          # routes between looks) into one review folder with a pick per look; then the picks written into komorebi-params.js and
          # presets.js (test-gl/adopt.mjs's header). Its GPU stages: same first-run setup as pixels; motion uses ffmpeg, as video does.
          adopt = pkgs.writeShellApplication {
            name = "adopt";
            runtimeInputs = [ pkgs.nodejs_22 pkgs.git pkgs.ffmpeg pkgs.gnutar ];
            text = ''exec node test-gl/adopt.mjs "$@"'';
          };
          # `nix run .#video -- --arboretum <id> --commit <sha> --out test-gl/out/video/<name> --seconds 300` — the headless
          # video exporter: one look (an arboretum preset, or --look-json <file>) stepped frame by frame on the Mac's GPU
          # (Chromium on Metal) into a lossless segment set and an HEVC delivery for a projector; `-- --help` lists every option.
          # The engine is a `git archive` of --commit (git, gnutar); ffmpeg is nix's. Same first-run setup as pixels: cd test-gl
          # && npm install && npx playwright install chromium. It runs from the repo root, and under macOS caffeinate -i when
          # that exists (/usr/bin, outside nix): a render of an hour must not idle-sleep.
          video = pkgs.writeShellApplication {
            name = "video";
            runtimeInputs = [ pkgs.nodejs_22 pkgs.ffmpeg pkgs.git pkgs.gnutar ];
            text = ''
              if [ ! -d test-gl/node_modules ]; then
                echo "first run: cd test-gl && npm install && npx playwright install chromium" >&2
                exit 1
              fi
              if command -v caffeinate >/dev/null; then
                exec caffeinate -i node test-gl/render-video.mjs "$@"
              fi
              exec node test-gl/render-video.mjs "$@"
            '';
          };
          # `nix run .#arboretum-dev [komorebi-checkout]` — arboretum's dev mode: this checkout (or another, such as a
          # worktree) at the root and arboretum's pages under /arboretum, on one https origin (arboretum/scripts/dev.mjs).
          # It runs from arboretum/, because it builds into .wrangler there and uses node_modules' wrangler.
          arboretum-dev = pkgs.writeShellApplication {
            name = "arboretum-dev";
            runtimeInputs = [ pkgs.nodejs_22 pkgs.git pkgs.bun pkgs.gzip ];
            text = ''
              cd "$(git rev-parse --show-toplevel)/arboretum"
              exec node scripts/dev.mjs "$@"
            '';
          };
          # `nix run .#arboretum-deploy` — the deploy, start to finish, of this checkout's HEAD (uncommitted changes are refused):
          # install exactly the lockfile, typecheck and test (each generating the engine from this tree first), build the site
          # (komorebi at the root, public/ under arboretum/, into the gitignored .site/), apply the D1 migrations to the live
          # database, then let wrangler build and upload the Worker and that site. Any failing step stops it before anything
          # reaches Cloudflare; the migration step asks before it touches the live database.
          arboretum-deploy = pkgs.writeShellApplication {
            name = "arboretum-deploy";
            runtimeInputs = [ pkgs.nodejs_22 pkgs.git pkgs.bun pkgs.gzip ];
            text = ''
              cd "$(git rev-parse --show-toplevel)/arboretum"
              npm ci
              npm run typecheck
              npm test
              node scripts/site.mjs
              npx wrangler d1 migrations apply komorebi-arboretum --remote
              npx wrangler deploy
            '';
          };
          # `nix run .#test [-- bun test args]` — the engine's unit tests (no browser). With no path or name pattern among the
          # arguments it runs every `test/*.test.js` in 4 parallel workers, one isolated process per file (about 16 s; 37 s
          # sequentially; more workers than 4 gain nothing); flags such as `--bail` pass through. With one or more, only those, in
          # one process: `nix run .#test -- test/air.test.js`.
          test = pkgs.writeShellApplication {
            name = "test";
            runtimeInputs = [ pkgs.bun ];
            text = ''
              named=0
              for a in "$@"; do
                case "$a" in -*) ;; *) named=1 ;; esac
              done
              if [ "$named" = 1 ]; then exec bun test "$@"; fi
              exec bun test --parallel=4 ./test/*.test.js "$@"
            '';
          };
          # `nix run .#arboretum-test [-- vitest args]` — arboretum's typecheck, then its tests in the Workers runtime; each
          # generates the engine from this tree first. First run: cd arboretum && nix develop -c npm ci.
          arboretum-test = pkgs.writeShellApplication {
            name = "arboretum-test";
            runtimeInputs = [ pkgs.nodejs_22 pkgs.git pkgs.bun pkgs.gzip ];
            text = ''
              cd "$(git rev-parse --show-toplevel)/arboretum"
              if [ ! -d node_modules ]; then
                echo "first run: cd arboretum && nix develop -c npm ci" >&2
                exit 1
              fi
              npm run typecheck
              exec npm test -- "$@"
            '';
          };
          # `nix run .#render-test [-- node --test args]` — komorebi-render's tests (node:test; no GPU, no network), from render/.
          render-test = pkgs.writeShellApplication {
            name = "render-test";
            runtimeInputs = [ pkgs.nodejs_22 pkgs.git pkgs.ffmpeg ];
            text = ''
              cd "$(git rev-parse --show-toplevel)/render"
              exec node --disable-warning=ExperimentalWarning --test "$@"
            '';
          };
        in {
          test = { type = "app"; program = "${test}/bin/test"; };
          render-test = { type = "app"; program = "${render-test}/bin/render-test"; };
          komorebi-render = { type = "app"; program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.komorebi-render}/bin/komorebi-render"; };
          arboretum-test = { type = "app"; program = "${arboretum-test}/bin/arboretum-test"; };
          arboretum-dev = { type = "app"; program = "${arboretum-dev}/bin/arboretum-dev"; };
          arboretum-deploy = { type = "app"; program = "${arboretum-deploy}/bin/arboretum-deploy"; };
          dev = { type = "app"; program = "${dev}/bin/dev"; };
          lint = { type = "app"; program = "${lint}/bin/lint"; };
          cost = { type = "app"; program = "${cost}/bin/cost"; };
          pattern = { type = "app"; program = "${pattern}/bin/pattern"; };
          rows = { type = "app"; program = "${rows}/bin/rows"; };
          build = { type = "app"; program = "${build}/bin/build"; };
          pixels = { type = "app"; program = "${pixels}/bin/pixels"; };
          editor = { type = "app"; program = "${editor}/bin/editor"; };
          embed = { type = "app"; program = "${embed}/bin/embed"; };
          review = { type = "app"; program = "${review}/bin/review"; };
          adopt = { type = "app"; program = "${adopt}/bin/adopt"; };
          video = { type = "app"; program = "${video}/bin/video"; };
          embed-check = { type = "app"; program = "${embed-check}/bin/embed-check"; };
          default = self.apps.${pkgs.system}.dev;
        });
    };
}
