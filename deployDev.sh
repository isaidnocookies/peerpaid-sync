#!/bin/bash

rsync -azv --exclude 'node_modules' --exclude '.git' --delete --delete-excluded ./ thelazycoder@peerpaid-dev-sync:~/peerpaid-sync/

ssh thelazycoder@peerpaid-dev-sync
