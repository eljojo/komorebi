{
  description = "Komorebi — WebGL2 komorebi engine: dev shell + serve/lint helpers";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      # `nix develop` — python3 (dev server) + biome (JS lint/format) on PATH.
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.python3 pkgs.biome ];
          shellHook = ''
            echo "komorebi dev shell — serve: python3 -m http.server 8000 | lint: biome lint komorebi.js"
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
        in {
          serve = { type = "app"; program = "${serve}/bin/serve"; };
          lint = { type = "app"; program = "${lint}/bin/lint"; };
          default = self.apps.${pkgs.system}.serve;
        });
    };
}
