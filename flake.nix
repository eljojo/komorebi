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
      in
      {
        # wrangler and vitest come from package.json, not from here.
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            git
          ];
        };
      });
}
