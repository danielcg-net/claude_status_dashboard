When Docker is invoked with `sudo` (e.g. `sudo docker compose up`), the `$HOME` environment variable resolves to `/root` instead of the calling user's home directory. This causes volume mounts like `${HOME}/.claude:/claude:ro` in `compose.yml` to bind-mount `/root/.claude` (which doesn't exist) instead of the real `~/.claude`. Docker creates an empty directory at the mount source, so `/claude` inside the container is empty, ccusage finds no `projects/` subdirectory, and the "Costs by repo" section shows "data not available."

**Fix:** Add the user to the `docker` group so Docker can be used without `sudo`:
```bash
sudo usermod -aG docker $USER
```
Then log out and back in (or run `newgrp docker`). After that `docker compose up` works without `sudo` and `$HOME` resolves correctly.

**Alternative:** Create a `.env` file next to `compose.yml` with `HOME=/home/username` to override the variable even under sudo. But the docker group approach is preferred.