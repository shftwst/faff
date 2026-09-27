# FAFF-1107 fixture image: bakes the SUT-cage bridge and the component source into ONE
# image, so the source lives with the bridge (the SUT cage) and the bridge answers the
# session RPC wire over TCP. The build context is staged by eval/bridge-fixture.mjs: it
# copies faff-bridge-node.mjs and its lib/ (which the bridge resolves via createRequire as
# ./lib/manifest.js) alongside this fixture's stack.mjs, binding-manifest.json, and
# package.json, so every COPY below resolves within one self-contained context.
FROM node:20-alpine
WORKDIR /app

COPY faff-bridge-node.mjs ./
COPY lib/ ./lib/
COPY stack.mjs ./
COPY binding-manifest.json ./
COPY package.json ./

# package.json's "type":"module" scopes /app to ESM, but the bridge loads its CommonJS
# lib (manifest.js, argv.js) via createRequire. Scope lib/ back to CommonJS so those
# require()-based modules resolve exactly as they do in the repo tree.
RUN printf '{ "type": "commonjs" }\n' > /app/lib/package.json

EXPOSE 8080

# Reflect stack.mjs over the wire. --module is relative to the bridge module, so ./stack.mjs
# resolves to /app/stack.mjs beside it; --host 0.0.0.0 makes the published port reachable.
CMD ["node", "faff-bridge-node.mjs", \
     "--manifest", "binding-manifest.json", \
     "--module", "./stack.mjs", \
     "--host", "0.0.0.0", \
     "--port", "8080"]
