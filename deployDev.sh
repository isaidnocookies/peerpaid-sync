#!/bin/bash

rsync -azv ./ thelazycoder@peerpaid-dev-sync:~/peerpaid-sync/

ssh thelazycoder@peerpaid-dev-sync
