## Purpose

Keeps the console's offline delivery trustworthy: every runtime file is
cached under an exact URL with a correct content digest, and drift is
detectable before a build is published.

## ADDED Requirements

### Requirement: Manifest lists every runtime file with its digest

`cache.appcache` SHALL list every runtime file the page can fetch under
`CACHE MANIFEST` with a lowercase SHA-256 digest that matches the file's
current bytes at publish time. Development-only files (agent guides, specs,
tooling, README, LICENSE) SHALL NOT be listed.

#### Scenario: A runtime file changes

- **WHEN** a listed runtime file is modified without updating its digest
- **THEN** verification reports that entry as drifted and identifies the file

#### Scenario: A runtime file is added

- **WHEN** a new runtime file is introduced without a manifest entry
- **THEN** verification reports the file as missing from the manifest

#### Scenario: Digest matches bytes

- **WHEN** verification passes on a published tree
- **THEN** every listed runtime file's digest equals its SHA-256, so the
  console treats no entry as stale

### Requirement: Duplicate module identity is cached under both URLs

The engine's core module SHALL remain cached under both of its request URLs
(plain and `?v=10`), and both entries SHALL always carry the same digest. All
engine imports of that module SHALL use one identical specifier so a single
module instance exists per page.

#### Scenario: Both entries stay in sync

- **WHEN** the core module changes
- **THEN** its plain entry and its `?v=10` entry are updated together with
  the same digest

#### Scenario: Query-string URL is a distinct entry

- **WHEN** a module is imported with a query string such as `?v=10`
- **THEN** the manifest contains an entry for that exact URL, separate from
  the entry for the same file without the query

### Requirement: Path changes preserve offline integrity in one revision

When runtime files are moved or renamed, all manifest entries and navigation
fallbacks SHALL be updated in the same manifest revision, and every fetched
URL (module imports, worker script, relative fetches, stylesheets, images)
SHALL remain represented in the manifest. Only files whose content did not
change SHALL be relocated, and their digest SHALL remain the same before and
after the move.

#### Scenario: Console loads after a move

- **WHEN** a console loads the page offline after a reorganization
- **THEN** every runtime asset loads from the cache and the page reaches its
  normal start state

#### Scenario: Content-identical relocation

- **WHEN** a third-party or frozen runtime file is relocated
- **THEN** its digest after the move equals its digest before the move,
  proving the move did not edit the file

#### Scenario: HTML entry points stay reachable

- **WHEN** the application is opened from each of its HTML entry points
- **THEN** the fallback mapping resolves that entry point from the cache
  offline

### Requirement: Manifest verification tool checks without writing

A zero-dependency local tool SHALL verify the manifest with a check mode that
writes nothing and exits non-zero on any drift, missing file or unlisted
runtime file. A write mode SHALL recompute digests in place.

#### Scenario: Clean check

- **WHEN** the check mode runs on a consistent tree
- **THEN** it makes no changes and exits successfully

#### Scenario: Drifted check

- **WHEN** the check mode runs after a runtime file changed without a
  manifest update
- **THEN** it exits non-zero and lists the affected manifest entries

#### Scenario: Missing file

- **WHEN** a manifest entry points at a file that does not exist
- **THEN** the check fails and names the missing path

### Requirement: Runtime bytes are stable across platforms

Runtime files SHALL be stored and served without end-of-line translation so
their digests are identical on every checkout and host, and the manifest
SHALL be served as a cache manifest with no caching of the manifest itself.

#### Scenario: Cross-platform checkout

- **WHEN** the repository is checked out on a different operating system
- **THEN** every runtime file's digest is unchanged

#### Scenario: Manifest freshness

- **WHEN** a console re-checks the manifest after a new build is published
- **THEN** it receives the current manifest rather than a cached copy
