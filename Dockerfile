# Used by Glama (and anyone else) to run the stdio MCP server from this repository.
# Starts with no secrets. Tools list on initialize. Never sign or broadcast.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY packages/helm-sdk/package.json packages/helm-sdk/package.json
COPY packages/helm-mcp/package.json packages/helm-mcp/package.json
COPY packages ./packages
RUN npm install --workspaces \
  && npm run build --workspace=helmswap \
  && npm run build --workspace=helmswap-mcp
ENV HELM_BASE_URL=https://helmswap.com
WORKDIR /app/packages/helm-mcp
CMD ["node", "dist/index.js"]
