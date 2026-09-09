# Blawx

Blawx is a local-first technology demo for turning a short text prompt into a
rotatable, full-3D brick-style model. It also converts voxel geometry into
ordinary rectangular brick placements and presents a draft construction guide
with an illustrated inventory, staged diagrams, and explicit warnings where the
experimental planner cannot determine a supported operation.

This is a prototype, not a physical buildability checker. A valid render or
completed conversion does not establish structural strength, stability, hand
clearance, parts availability, visual quality, or safe construction. The guide's
`Draft` and unresolved-operation markings are intentional.

Blawx is an independent project and is not affiliated with or endorsed by the
LEGO Group. LEGO is a trademark of the LEGO Group.

## What is included

- The product view at `/`, with a featured set, six saved examples, a persistent
  local recent-results feed, and an optional local prompt workflow.
- Rotatable raw voxel, brick, and adjusted construction views.
- A deterministic local conversion and bounded assembly-planning pipeline.
- A scrolling draft guide with section previews, numbered diagrams, join views,
  inventories, and unresolved-operation diagnostics.
- A shared rotatable model stage and generation progress carousel across the
  home and detail views.
- A geometry lab at `/?lab` for the retained generated examples and prepared
  studies.
- An instruction-appearance fixture at `/instruction-appearance.html`.

The six product examples are generated voxel outputs retained as:

| Shape | UI label |
| --- | --- |
| 42 | Coral reef |
| 43 | Cat |
| 44 | Red pickup |
| 45 | Dragon lighthouse |
| 46 | Spaghetti |
| 47 | Nostalgia |

The files under `public/examples/` are labeled generated model outputs. The
files under `public/fixtures/` are labeled prepared studies: authored examples
or deliberately transformed fixtures used to exercise geometry and presentation
behavior. Prepared does not mean model-generated, and generated output is not
presented as human-authored. The JSON indexes are the authoritative catalogue
and provenance boundary for the files included in this checkout.

## Quick start

Node.js 22 and a POSIX-compatible shell are required for the tested setup path.

```sh
./setup.sh
npm run dev
```

Then open <http://127.0.0.1:5178>. The six saved examples work without a model
call. `setup.sh` checks Node, changes to its own directory safely, and installs
the lockfile exactly with package lifecycle scripts, funding prompts, and audit
network requests disabled. It does not start a server or sign in to anything.

The optional geometry lab loads Inter and DM Mono from Google Fonts, which
contacts an external service when available. It falls back to local fonts when
that request is blocked or offline. Saved geometry does not require a model call.

Windows users without a POSIX shell can run the equivalent install command from
the repository directory after confirming Node.js 22:

```sh
npm ci --ignore-scripts --no-audit --no-fund
```

Useful commands:

```sh
npm test          # run the complete Node test suite
npm run build     # create the static site in dist/
npm run preview   # preview that static build on 127.0.0.1:4173
```

The test suite uses local fixtures and injected provider doubles. Ordinary
setup, tests, and builds do not intentionally make model-provider calls.

## Optional local prompt generation

Typed prompts use the local development server and the Codex CLI authenticated
with your own ChatGPT account. Install the CLI using the current
[Codex CLI instructions](https://learn.chatgpt.com/docs/codex/cli), then sign in
as described in [Codex authentication](https://learn.chatgpt.com/docs/auth).
The server reuses that local sign-in through `codex exec`; never copy or seed
someone else's credentials.

This checkout requests `gpt-6-astra` with low reasoning effort and the fast
service tier. Access depends on the models and features available to your
account. ChatGPT plan usage limits apply. The intended subscription route does
not require `OPENAI_API_KEY`, and there is no automatic paid API fallback.

Start `npm run dev`, open the loopback URL, and submit a typed prompt. The UI
action is the explicit opt-in to one bounded generation request. Successful
results and their prompts are saved in the local `Recently made` feed and are
visible to anyone who can use that running local app. Do not submit secrets,
personal information, or text you do not want stored. Exact normalized prompt
matches reuse the saved result without a new provider request.

Uncached semantic-section naming is paused by default. Exact saved annotations
may still be used when their fingerprints validate; otherwise the guide keeps
its structural fallback names. The implementation uses a 90-second provider
timeout and performs no application-level retry. The Codex CLI transport may
perform its own retries; this wrapper does not configure or count them.

Generation is deliberately local-only. The development server binds to
`127.0.0.1`; its host/origin checks are not authentication for a deployed
service. Do not expose it as a shared or public execution endpoint. A static
`npm run build` contains the viewer and saved data but no generation backend, so
typed generation is unavailable when only `dist/` is hosted. For background on
how the CLI reuses a saved login, see the official
[non-interactive mode documentation](https://learn.chatgpt.com/docs/non-interactive-mode).

### Private run data

Local generation records can include prompts, raw event streams, diagnostics,
and generated models. They are written outside the repository. On POSIX
systems, Blawx requests owner-only directory and file modes (`0700` and `0600`).
Those mode bits do not create equivalent Windows ACLs, so Windows users should
choose a location protected for their account. The default private root is:

- macOS: `~/Library/Application Support/blawx/private`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/blawx/private`
- Windows: `%LOCALAPPDATA%/blawx/private`

Set `BLAWX_PRIVATE_DATA_DIR` to choose another absolute or relative location,
but it must resolve outside the application tree and every Git worktree,
including paths reached through symlinks. Generation receipts are stored
under `generation/<request-id>/`; semantic receipts and cache data are stored
under `semantic-guides/`; the local feed database is stored under
`feed/results.sqlite`. These records are private working data, not public
fixtures, and are not served by Vite. Hidden feed rows remain in that private
database; this prototype does not provide multi-user accounts, secure deletion,
or a hosted privacy boundary.

Some research command-line utilities remain for reproducibility work. Their
live modes require an explicit live flag and a positive request/session bound;
their outputs also use private storage. They are not part of setup, testing, or
the static demo.

Export utilities require explicit input and output paths. Choosing a public
destination is a deliberate export: review the data and its rights first.
Keep private working notes outside Git rather than relying only on ignores.

## Construction and semantic-guide limits

Brick conversion and assembly planning are deterministic, bounded searches.
They preserve failures instead of hiding them: unsupported roots, blocked joins,
and unresolved placements remain visible in the draft guide. The system uses
ordinary rectangular brick abstractions and does not model every real-world
part, tolerance, collision, force, or building technique.

Saved semantic chapter names are accepted only when their fingerprint matches
the exact current construction plan and their coverage validates. A stale or
invalid annotation falls back to the structural section labels; it is not
silently relabeled and does not trigger inference for a saved example.

## Contributing

Keep provider calls out of tests and builds. Use injected providers or fixtures
for automated coverage, preserve unresolved construction states in assertions,
and run both checks before proposing a change:

```sh
npm test
npm run build
```

Do not commit private run directories, credentials, model login state,
unreviewed third-party assets, or `node_modules/`. A future external import must
be reviewed under its own terms; this project's MIT license does not clear
rights in third-party inputs, generated outputs, or assets.

`.gitignore` does not protect files already tracked by Git, and force-adding a
file bypasses it. Before any release, inspect the staged changes, scan the
complete exported history for secrets, and review files and metadata for
private content. An empty secret-scanner report is not a privacy guarantee.


## License

Project code is available under the [MIT License](LICENSE), to the extent the
copyright holder can grant those rights. Included dependencies remain under
their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). A copy
of the notices is also included in static builds as
`THIRD_PARTY_NOTICES.txt`.
