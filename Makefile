.PHONY: prototype check test fixtures

prototype:
	python3 -m http.server 4173 --bind 127.0.0.1 --directory docs/archive

check:
	node --check term-kind.js
	node --check suggestions.js
	node --check page-context.js
	node --check word-type.js
	node --check collocation-type.js
	node --check sources.js
	node --check enrich.js
	node --check background.js
	node --check content.js
	node --check popup.js
	node --check options.js
	python3 -m json.tool manifest.json >/dev/null

test:
	node --test "tests/*.test.mjs"

fixtures:
	node tests/fixtures/probe.mjs
