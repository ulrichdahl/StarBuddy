#!/bin/sh
# Wraps spec.html (artifact-format, no document skeleton) into a complete
# HTML document for GitHub Pages. Run from the repo root after editing spec.html.
set -eu
mkdir -p docs
{
  printf '<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
  cat spec.html
  printf '</html>\n'
} > docs/index.html
echo "Wrote docs/index.html"
