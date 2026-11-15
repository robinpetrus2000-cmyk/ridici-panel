#!/bin/sh
# Zkompiluje zdrojáky do souborů, které načítá prohlížeč (React z CDN, žádný bundler).
# Potřebuje esbuild: npm i -g esbuild
set -e
cd "$(dirname "$0")"
esbuild src/panel.jsx --jsx-factory=React.createElement --jsx-fragment=React.Fragment --target=es2020 --minify --charset=utf8 --outfile=panel.js
echo "Hotovo: panel.js"
