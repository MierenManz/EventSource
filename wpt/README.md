To run the tests:

1. Make sure the `wpt` submodule is initialized. Do `git submodule init` to
   be sure. (Note that the first time you do that, it might take a while to
   clone the entire WPT repo, you can do `git submodule init --depth=1`.)
2. `./wpt/wpt.ts setup`
3. `./wpt/wpt.ts run`
