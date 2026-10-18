#!/usr/bin/env bash
# Standalone release installation; pacman packages install the same unit in /usr/lib.
set -euo pipefail
release_dir=$(cd -- "$(dirname -- "$0")" && pwd)
install -Dm755 "$release_dir/llm-compare" "$HOME/.local/bin/llm-compare"
mkdir -p "$HOME/.config/systemd/user"
sed "s|ExecStart=/usr/bin/llm-compare |ExecStart=$HOME/.local/bin/llm-compare |" \
  "$release_dir/llm-compare.service" > "$HOME/.config/systemd/user/llm-compare.service"
if [[ ! -e "$HOME/.config/llm-compare/config.yaml" ]]; then
  "$HOME/.local/bin/llm-compare" init --config "$HOME/.config/llm-compare/config.yaml"
fi
systemctl --user daemon-reload
printf '%s\n' '安装完成。请检查配置并运行 doctor，再使用 systemctl --user enable --now llm-compare。'
