# Publish commands (for Colby — do not run from an agent)

Nothing in this folder has been published or pushed. Run these yourself after you have reviewed the README and fee text.

## 0. npm org (required for the scoped names)

The packages are `@summit-pc/helm` and `@summit-pc/helm-mcp`. The npm org `summit-pc` did not exist on 19 Nov 2026 (registry returned ResourceNotFound). All of these names were also unused (HTTP 404): `@summit-pc/helm`, `@summit-pc/helm-mcp`, `helmswap`, `helmswap-sdk`, `helmswap-mcp`.

1. Create an npm account if you do not have one: https://www.npmjs.com/signup
2. Create a public org named `summit-pc`: https://www.npmjs.com/org/create
3. Then:

```bash
npm login
```

If you would rather skip the org, rename the packages to the unscoped names `helmswap` and `helmswap-mcp` before publishing, and update `mcpName` / `server.json` to match.

## 1. GitHub repo

```bash
cd /workspace/launch-hours-20261118/helmswap-sdk
git init
git add .
git commit -m "Initial public HelmSwap SDK and MCP server"
gh repo create gambrelcolby63/helmswap-sdk --public --source . --remote origin --push
```

Do not force-push. Do not add secrets.

## 2. npm publish (SDK first, then MCP)

From this repo, after `npm login` and `npm test && npm run build`:

```bash
# SDK first — the MCP package depends on @summit-pc/helm@0.1.0
npm publish --workspace=@summit-pc/helm --access public

# Then the MCP server
npm publish --workspace=@summit-pc/helm-mcp --access public
```

`publishConfig.provenance` is on. If npm refuses provenance from your laptop, either publish from GitHub Actions later or temporarily remove `"provenance": true` from each package's `publishConfig` and retry `npm publish --access public`.

Confirm:

- https://www.npmjs.com/package/@summit-pc/helm
- https://www.npmjs.com/package/@summit-pc/helm-mcp

Do not run `npm publish` from an agent session.
