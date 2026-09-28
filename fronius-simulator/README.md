# Fronius Simulator

Le simulateur Fronius fournit un service Rust qui émule un onduleur et un compteur intelligent via la Solar API v1, ainsi qu'un visualiseur énergétique statique.

## Documentation

La documentation générale du simulateur se trouve dans [docs/FRONIUS_SIMULATOR.md](../docs/FRONIUS_SIMULATOR.md).

## Développement

Depuis ce répertoire, et non depuis la racine du dépôt : le visualiseur est résolu par rapport au répertoire de travail du processus.

```sh
cargo test
cargo clippy --all-targets
cargo fmt --check
node --test 'viewer-tests/*.test.js'
cargo run -- --day-duration-seconds 600
```

Le visualiseur utilise des modules ES natifs et une copie vendorizée de uPlot ; aucune installation npm n'est nécessaire.
