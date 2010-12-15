SHELL := /bin/bash

user=postgres
password=1234
host=localhost
port=5432
database=postgres

test-unit:
	@find test/unit -name "*-tests.js" | xargs -n 1 -I file node file

test-integration:
	@find test/integration -name "*-tests.js" | xargs -n 1 -I file node file -u $(user) --password $(password) -p $(port) -d $(database) -h $(host)

test-all: test-unit test-integration
test: test-unit

.PHONY : test
