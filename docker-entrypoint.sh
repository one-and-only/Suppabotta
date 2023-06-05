#!/bin/sh
cd app || exit 2

if [ ! -d "/app" ]; then
    echo "Please link the app directory to the docker container (\`-v ...:...\`)"
    return
fi

if [ ! -d "node_modules" ]; then
    npm i
fi

node index.js