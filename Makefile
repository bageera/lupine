.PHONY: build test e2e serve clean

build:
	cargo build --target wasm32-unknown-unknown --release
	cp target/wasm32-unknown-unknown/release/lupine.wasm web/

test:
	cargo test

e2e: build
	node scripts/e2e.mjs
	node scripts/e2e-formats.mjs

serve:
	python3 -m http.server -d web 8000

clean:
	rm -rf target web/lupine.wasm web/test.wav