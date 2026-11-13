# To-do

- [ ] Research 3D map view - solar system
- [ ] Orders: show SSH-signed commits as signed but unchecked, since git reports them as N without an allowed-signers file
- [ ] Orders: cache each order's signature check by commit, so a check doesn't run gpg for every order every time
- [ ] Runs: ask before Remove folder, since it also deletes ignored files such as .env
- [ ] Runs: save records for repos whose .git is a file (linked worktrees, submodules)
- [ ] Runs: check new run ids against saved ones, now that records are kept
- [ ] Runs: save the last lines before a hard restart (saves are throttled to every 2 seconds)
- [ ] Review: show non-ASCII conflict file names unescaped (core.quotePath=false)
- [ ] Tests: cover removing an order run's folder, and the merge check in an empty checkout
- [ ] Lamps: a Claude chat that ends in a local slash command shows Working until it goes quiet
